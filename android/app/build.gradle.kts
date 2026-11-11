plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.maandlee.carprint"
    compileSdk = 34
    useLibrary("android.car", false)
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "com.maandlee.carprint"
        minSdk = 28
        targetSdk = 34
        versionCode = 2
        versionName = "0.2.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    flavorDimensions += "environment"
    // 제출 APK 자체를 검사할 때만 release와 같은 서명으로 instrumentation을 만든다.
    testBuildType = providers.gradleProperty("carprintTestBuildType").getOrElse("debug")
    val signingFile = providers.environmentVariable("CARPRINT_SIGNING_STORE_FILE").orNull
    if (signingFile != null) {
        signingConfigs {
            create("submission") {
                storeFile = file(signingFile)
                storePassword = providers.environmentVariable("CARPRINT_SIGNING_STORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("CARPRINT_SIGNING_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("CARPRINT_SIGNING_KEY_PASSWORD").get()
            }
        }
        buildTypes.getByName("release").signingConfig = signingConfigs.getByName("submission")
    }
    productFlavors {
        create("pleos") {
            dimension = "environment"
            applicationIdSuffix = ".pleos"
            versionNameSuffix = "-pleos"
        }
        create("demo") {
            dimension = "environment"
            applicationIdSuffix = ".demo"
            versionNameSuffix = "-demo"
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = true }
}
dependencies {
    "pleosImplementation"("ai.pleos.playground:Vehicle:2.3.2")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test:rules:1.5.0")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
dependencyLocking { lockAllConfigurations() }
