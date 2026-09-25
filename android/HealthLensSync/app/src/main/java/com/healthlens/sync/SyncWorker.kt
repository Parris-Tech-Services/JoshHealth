package com.healthlens.sync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val sharedPrefs = applicationContext.getSharedPreferences("HealthLensSyncPrefs", Context.MODE_PRIVATE)
        val endpoint = sharedPrefs.getString("endpoint", "") ?: ""
        val token = sharedPrefs.getString("token", "") ?: ""

        if (endpoint.isBlank() || token.isBlank()) {
            sharedPrefs.edit().putString("lastSync", "Failed (Worker): Missing config").apply()
            return Result.failure()
        }

        try {
            val client = HealthConnectClient.getOrCreate(applicationContext)
            
            // Check permissions before reading (avoid crashing in worker)
            val requiredPermissions = setOf(
                androidx.health.connect.client.permission.HealthPermission.getReadPermission(StepsRecord::class),
                androidx.health.connect.client.permission.HealthPermission.getReadPermission(SleepSessionRecord::class),
                androidx.health.connect.client.permission.HealthPermission.getReadPermission(HeartRateRecord::class),
                androidx.health.connect.client.permission.HealthPermission.getReadPermission(WeightRecord::class)
            )
            val granted = client.permissionController.getGrantedPermissions()
            if (!granted.containsAll(requiredPermissions)) {
                sharedPrefs.edit().putString("lastSync", "Failed (Worker): Missing permissions").apply()
                return Result.failure()
            }

            val start = Instant.now().minus(7, ChronoUnit.DAYS)
            val end = Instant.now()
            val filter = TimeRangeFilter.between(start, end)
            
            val zoneId = ZoneId.systemDefault()
            val startDate = LocalDate.ofInstant(start, zoneId).toString()
            val endDate = LocalDate.ofInstant(end, zoneId).toString()

            val stepsResponse = client.readRecords(ReadRecordsRequest(StepsRecord::class, filter))
            val totalSteps = stepsResponse.records.sumOf { it.count }

            val sleepResponse = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, filter))
            val sleepRecords = JSONArray()
            sleepResponse.records.forEach { record ->
                val duration = ChronoUnit.MINUTES.between(record.startTime, record.endTime)
                sleepRecords.put(JSONObject().apply {
                    put("start_time", record.startTime.toString())
                    put("end_time", record.endTime.toString())
                    put("duration_minutes", duration)
                    put("source_id", "health_connect")
                })
            }

            val weightResponse = client.readRecords(ReadRecordsRequest(WeightRecord::class, filter))
            val bodyRecords = JSONArray()
            weightResponse.records.forEach { record ->
                bodyRecords.put(JSONObject().apply {
                    put("timestamp", record.time.toString())
                    put("metric_type", "weight_kg")
                    put("value", record.weight.inKilograms)
                    put("source_id", "health_connect")
                })
            }

            val heartResponse = client.readRecords(ReadRecordsRequest(HeartRateRecord::class, filter))
            val heartRecords = JSONArray()
            heartResponse.records.forEach { record ->
                record.samples.forEach { sample ->
                    heartRecords.put(JSONObject().apply {
                        put("timestamp", sample.time.toString())
                        put("metric_type", "heart_rate")
                        put("value", sample.beatsPerMinute)
                        put("source_id", "health_connect")
                    })
                }
            }

            val payload = JSONObject().apply {
                put("deviceIdHash", "android-health-connect-sync-worker")
                put("dateRange", JSONObject().apply {
                    put("start", startDate)
                    put("end", endDate)
                })
                put("dailySummaries", JSONArray().put(JSONObject().apply {
                    put("date", endDate)
                    put("timezone", zoneId.id)
                    put("steps", totalSteps)
                    put("sleep_minutes", if (sleepResponse.records.isNotEmpty()) ChronoUnit.MINUTES.between(sleepResponse.records.first().startTime, sleepResponse.records.last().endTime) else 0)
                    put("source_confidence", 1.0)
                    put("sources", JSONObject().put("health_connect", true))
                }))
                put("sleepRecords", sleepRecords)
                put("heartRecords", heartRecords)
                put("bodyRecords", bodyRecords)
                put("syncStartedAt", OffsetDateTime.now().toString())
                put("appVersion", "HealthLensSync/0.5.0-worker")
            }

            val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 20000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
            }

            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(payload.toString())
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            connection.disconnect()

            val failTime = Instant.now().toString()
            if (status in 200..299) {
                sharedPrefs.edit().putString("lastSync", "Success (Worker): $failTime").apply()
                return Result.success()
            } else {
                sharedPrefs.edit().putString("lastSync", "Failed (Worker HTTP $status) at $failTime").apply()
                return Result.retry()
            }

        } catch (e: Exception) {
            val failTime = Instant.now().toString()
            sharedPrefs.edit().putString("lastSync", "Failed (Worker Exception) at $failTime").apply()
            return Result.retry()
        }
    }
}
