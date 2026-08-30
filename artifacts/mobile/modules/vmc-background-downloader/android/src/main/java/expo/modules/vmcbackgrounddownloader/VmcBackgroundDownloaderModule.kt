package expo.modules.vmcbackgrounddownloader

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File

private class BackgroundDownloadException(message: String) : CodedException(message)

private data class EnqueueOptions(
  @Field val url: String,
  @Field val fileName: String,
  @Field val headers: Map<String, String> = emptyMap(),
  @Field val title: String = "VMC Electronic BMS update",
  @Field val description: String = "Downloading application update",
  @Field val identity: String,
  @Field val metadataJson: String,
) : Record

class VmcBackgroundDownloaderModule : Module() {
  private val enqueueLock = Any()

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  private val downloadManager: DownloadManager
    get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  private val preferences
    get() = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("VmcBackgroundDownloader")

    AsyncFunction("enqueueAsync") { options: EnqueueOptions ->
      synchronized(enqueueLock) {
        val existingId = preferences.getString(KEY_DOWNLOAD_ID, null)?.toLongOrNull()
        val existingIdentity = preferences.getString(KEY_IDENTITY, null)
        if (existingId != null && existingIdentity == options.identity) {
          val existingStatus = readStatus(existingId)["status"]
          if (
            existingStatus == "pending" ||
            existingStatus == "running" ||
            existingStatus == "paused" ||
            existingStatus == "successful"
          ) {
            return@synchronized mapOf(
              "downloadId" to existingId.toString(),
              "reused" to true,
            )
          }
        }
        if (existingId != null) {
          downloadManager.remove(existingId)
          clearStoredDownload(existingId)
        }

        val uri = Uri.parse(options.url)
        if (uri.scheme != "https") {
          throw BackgroundDownloadException("Only HTTPS update downloads are allowed")
        }

        val fileName = options.fileName.replace(Regex("[^A-Za-z0-9._-]"), "_")
        if (!fileName.lowercase().endsWith(".apk")) {
          throw BackgroundDownloadException("The update destination must be an APK")
        }

        val downloadsDirectory =
          context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: throw BackgroundDownloadException("External app storage is unavailable")
        if (!downloadsDirectory.exists() && !downloadsDirectory.mkdirs()) {
          throw BackgroundDownloadException("Could not prepare update storage")
        }
        val destination = File(downloadsDirectory, fileName)
        if (destination.exists() && !destination.delete()) {
          throw BackgroundDownloadException("Could not replace the previous update file")
        }

        val request = DownloadManager.Request(uri)
          .setTitle(options.title.take(100))
          .setDescription(options.description.take(160))
          .setMimeType(APK_MIME_TYPE)
          .setAllowedOverMetered(true)
          .setAllowedOverRoaming(false)
          // Keep the system progress notification while downloading, but remove
          // it on completion so an unverified APK cannot be opened from there.
          .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
          .setDestinationInExternalFilesDir(
            context,
            Environment.DIRECTORY_DOWNLOADS,
            fileName,
          )

        options.headers["Authorization"]?.let { authorization ->
          if (authorization.contains('\n') || authorization.contains('\r')) {
            throw BackgroundDownloadException("Invalid authorization header")
          }
          request.addRequestHeader("Authorization", authorization)
        }

        val downloadId = downloadManager.enqueue(request)
        val stored = preferences.edit()
          .putString(KEY_DOWNLOAD_ID, downloadId.toString())
          .putString(KEY_IDENTITY, options.identity)
          .putString(KEY_METADATA, options.metadataJson)
          .commit()
        if (!stored) {
          downloadManager.remove(downloadId)
          throw BackgroundDownloadException("Could not persist the update download")
        }
        mapOf(
          "downloadId" to downloadId.toString(),
          "reused" to false,
        )
      }
    }

    AsyncFunction("getStatusAsync") { downloadId: String ->
      val id = parseDownloadId(downloadId)
      readStatus(id)
    }

    AsyncFunction("getStoredDownloadAsync") {
      val downloadId = preferences.getString(KEY_DOWNLOAD_ID, null)
        ?: return@AsyncFunction null
      val identity = preferences.getString(KEY_IDENTITY, null)
        ?: return@AsyncFunction null
      val metadataJson = preferences.getString(KEY_METADATA, null)
        ?: return@AsyncFunction null
      mapOf(
        "downloadId" to downloadId,
        "identity" to identity,
        "metadataJson" to metadataJson,
      )
    }

    AsyncFunction("cancelAsync") { downloadId: String ->
      val id = parseDownloadId(downloadId)
      val removed = downloadManager.remove(id) > 0
      clearStoredDownload(id)
      removed
    }

    AsyncFunction("openInstallerAsync") { downloadId: String ->
      val id = parseDownloadId(downloadId)
      val snapshot = readStatus(id)
      if (snapshot["status"] != "successful") {
        throw BackgroundDownloadException("The APK download is not complete")
      }
      val contentUri = downloadManager.getUriForDownloadedFile(id)
        ?: throw BackgroundDownloadException("The downloaded APK is unavailable")
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, APK_MIME_TYPE)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      if (intent.resolveActivity(context.packageManager) == null) {
        throw BackgroundDownloadException("No Android package installer is available")
      }
      context.startActivity(intent)
      true
    }
  }

  private fun parseDownloadId(downloadId: String): Long {
    return downloadId.toLongOrNull()
      ?: throw BackgroundDownloadException("Invalid download identifier")
  }

  private fun clearStoredDownload(id: Long) {
    if (preferences.getString(KEY_DOWNLOAD_ID, null) == id.toString()) {
      preferences.edit()
        .remove(KEY_DOWNLOAD_ID)
        .remove(KEY_IDENTITY)
        .remove(KEY_METADATA)
        .commit()
    }
  }

  private fun readStatus(id: Long): Map<String, Any?> {
    val query = DownloadManager.Query().setFilterById(id)
    downloadManager.query(query).use { cursor ->
      if (cursor == null || !cursor.moveToFirst()) {
        return statusMap(id, "missing", 0L, 0L, null, null)
      }
      val nativeStatus =
        cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
      val status = when (nativeStatus) {
        DownloadManager.STATUS_PENDING -> "pending"
        DownloadManager.STATUS_RUNNING -> "running"
        DownloadManager.STATUS_PAUSED -> "paused"
        DownloadManager.STATUS_SUCCESSFUL -> "successful"
        DownloadManager.STATUS_FAILED -> "failed"
        else -> "missing"
      }
      val bytesDownloaded = cursor.getLong(
        cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR),
      ).coerceAtLeast(0L)
      val totalBytes = cursor.getLong(
        cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES),
      ).coerceAtLeast(0L)
      val localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
      val localUri =
        if (localUriIndex >= 0 && !cursor.isNull(localUriIndex)) {
          cursor.getString(localUriIndex)
        } else {
          null
        }
      val reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
      val reason =
        if (reasonIndex >= 0 && !cursor.isNull(reasonIndex)) {
          cursor.getInt(reasonIndex)
        } else {
          null
        }
      return statusMap(id, status, bytesDownloaded, totalBytes, localUri, reason)
    }
  }

  private fun statusMap(
    id: Long,
    status: String,
    bytesDownloaded: Long,
    totalBytes: Long,
    localUri: String?,
    reason: Int?,
  ): Map<String, Any?> {
    return mapOf(
      "downloadId" to id.toString(),
      "status" to status,
      "bytesDownloaded" to bytesDownloaded.toDouble(),
      "totalBytes" to totalBytes.toDouble(),
      "localUri" to localUri,
      "reason" to reason,
    )
  }

  companion object {
    private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    private const val PREFERENCES_NAME = "vmc_background_update_download"
    private const val KEY_DOWNLOAD_ID = "download_id"
    private const val KEY_IDENTITY = "identity"
    private const val KEY_METADATA = "metadata_json"
  }
}