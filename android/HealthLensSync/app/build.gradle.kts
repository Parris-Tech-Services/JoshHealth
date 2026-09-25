plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.healthlens.sync"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.healthlens.sync"
    minSdk = 26
    targetSdk = 34
    versionCode = 1
    versionName = "0.2.0"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }
}

dependencies {
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("com.google.android.material:material:1.10.0")
  implementation("androidx.work:work-runtime-ktx:2.9.0")
  implementation("androidx.health.connect:connect-client:1.1.0-alpha07")
}
