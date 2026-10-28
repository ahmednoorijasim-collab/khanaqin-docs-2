package com.ahmed.docscanner

import android.content.ContentValues
import android.content.Intent
import android.graphics.*
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.*
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.card.MaterialCardView
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult

class MainActivity : AppCompatActivity() {
    private lateinit var bw: CompoundButton

    private val scanLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r ->
        if (r.resultCode == RESULT_OK) {
            GmsDocumentScanningResult.fromActivityResultIntent(r.data)?.pdf?.uri?.let { u ->
                work { val b = contentResolver.openInputStream(u)!!.use { it.readBytes() }; save(b, "scan") }
            }
        }
    }
    private val imagesPicker = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { l ->
        if (l.isNotEmpty()) work {
            val doc = PdfDocument()
            l.forEachIndexed { i, u -> val b = loadImage(u); addPage(doc, if (bw.isChecked) toBw(b) else b, i + 1) }
            finish(doc, "images")
        }
    }
    private val mergePicker = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { l ->
        if (l.size > 1) work { finish(rebuild(l, 1, Int.MAX_VALUE), "merged") }
        else if (l.isNotEmpty()) toast("اختر ملفين PDF أو أكثر")
    }
    private val splitPicker = registerForActivityResult(ActivityResultContracts.GetContent()) { u ->
        if (u != null) {
            val et = EditText(this).apply { hint = "مثال: 2-4"; }
            AlertDialog.Builder(this).setTitle("أي صفحات تريد استخراجها؟").setView(et)
                .setPositiveButton("استخراج") { _, _ ->
                    val p = et.text.toString().split("-").mapNotNull { it.trim().toIntOrNull() }
                    if (p.isNotEmpty()) work { finish(rebuild(listOf(u), p[0], p.getOrElse(1) { p[0] }), "split") }
                }.setNegativeButton("إلغاء", null).show()
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun card(icon: String, title: String, sub: String, onClick: () -> Unit): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(18))
        }
        row.addView(TextView(this).apply { text = icon; textSize = 30f; setPadding(0, 0, dp(16), 0) })
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(TextView(this).apply {
            text = title; textSize = 17f; setTextColor(0xFF0F172A.toInt()); setTypeface(null, Typeface.BOLD)
        })
        col.addView(TextView(this).apply { text = sub; textSize = 13f; setTextColor(0xFF64748B.toInt()) })
        row.addView(col)
        return MaterialCardView(this).apply {
            radius = dp(16).toFloat()
            cardElevation = dp(3).toFloat()
            setCardBackgroundColor(Color.WHITE)
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
            addView(row)
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
                setMargins(dp(16), dp(8), dp(16), dp(8))
            }
        }
    }

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        val page = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF1E3A8A.toInt())
            setPadding(dp(24), dp(56), dp(24), dp(32))
        }
        header.addView(TextView(this).apply {
            text = "وثائق خانقين 2"; textSize = 28f; setTextColor(Color.WHITE); setTypeface(null, Typeface.BOLD)
        })
        header.addView(TextView(this).apply {
            text = "امسح • حوّل • ادمج • قسّم"; textSize = 14f
            setTextColor(0xFFBFD0F5.toInt()); setPadding(0, dp(6), 0, 0)
        })
        page.addView(header)

        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(12), 0, dp(24)) }
        list.addView(card("📷", "مسح مستند", "الكاميرا مع قص تلقائي وفلاتر") { startScan() })
        list.addView(card("🖼️", "صور إلى PDF", "اختر صوراً من المعرض") { imagesPicker.launch("image/*") })
        bw = MaterialSwitch(this).apply {
            text = "تحويل الصور إلى أبيض وأسود"
            setPadding(dp(32), dp(4), dp(32), dp(4))
        }
        list.addView(bw)
        list.addView(card("📎", "دمج ملفات PDF", "اختر ملفين أو أكثر") { mergePicker.launch("application/pdf") })
        list.addView(card("✂️", "تقسيم PDF", "استخرج صفحات محددة") { splitPicker.launch("application/pdf") })
        page.addView(ScrollView(this).apply { addView(list) })
        setContentView(page)
    }

    private fun startScan() {
        val o = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(30)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
        GmsDocumentScanning.getClient(o).getStartScanIntent(this)
            .addOnSuccessListener { scanLauncher.launch(IntentSenderRequest.Builder(it).build()) }
            .addOnFailureListener { toast("تعذر فتح الماسح: ${it.message}") }
    }

    private fun work(f: () -> Unit) = Thread {
        try { f() } catch (e: Exception) { runOnUiThread { toast("خطأ: ${e.message}") } }
    }.start()

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_LONG).show()

    private fun loadImage(u: Uri): Bitmap {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(u)!!.use { BitmapFactory.decodeStream(it, null, o) }
        o.inJustDecodeBounds = false
        o.inSampleSize = maxOf(1, maxOf(o.outWidth, o.outHeight) / 2000)
        val b = contentResolver.openInputStream(u)!!.use { BitmapFactory.decodeStream(it, null, o) }!!
        val deg = contentResolver.openInputStream(u)!!.use {
            when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        }
        return if (deg == 0f) b else Bitmap.createBitmap(b, 0, 0, b.width, b.height, Matrix().apply { postRotate(deg) }, true)
    }

    private fun toBw(src: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val c = 1.7f; val t = (-0.5f * c + 0.5f) * 255
        val cm = ColorMatrix().apply { setSaturation(0f) }
        cm.postConcat(ColorMatrix(floatArrayOf(c, 0f, 0f, 0f, t, 0f, c, 0f, 0f, t, 0f, 0f, c, 0f, t, 0f, 0f, 0f, 1f, 0f)))
        Canvas(out).drawBitmap(src, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(cm) })
        return out
    }

    private fun addPage(doc: PdfDocument, b: Bitmap, n: Int) {
        val p = doc.startPage(PdfDocument.PageInfo.Builder(b.width, b.height, n).create())
        p.canvas.drawBitmap(b, 0f, 0f, null)
        doc.finishPage(p)
    }

    private fun rebuild(uris: List<Uri>, from: Int, to: Int): PdfDocument {
        val doc = PdfDocument(); var n = 0
        for (u in uris) contentResolver.openFileDescriptor(u, "r")!!.use { pfd ->
            val r = PdfRenderer(pfd)
            try {
                for (i in 0 until r.pageCount) {
                    if (i + 1 < from || i + 1 > to) continue
                    val p = r.openPage(i)
                    try {
                        val b = Bitmap.createBitmap(p.width * 2, p.height * 2, Bitmap.Config.ARGB_8888)
                        b.eraseColor(Color.WHITE)
                        p.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        addPage(doc, b, ++n); b.recycle()
                    } finally { p.close() }
                }
            } finally { r.close() }
        }
        if (n == 0) throw Exception("لا توجد صفحات بهذا النطاق")
        return doc
    }

    private fun finish(doc: PdfDocument, name: String) {
        val bos = java.io.ByteArrayOutputStream(); doc.writeTo(bos); doc.close()
        save(bos.toByteArray(), name)
    }

    private fun save(bytes: ByteArray, name: String) {
        val cv = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "${name}_${System.currentTimeMillis()}.pdf")
            put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
            put(MediaStore.Downloads.RELATIVE_PATH, "Download")
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)!!
        contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
        runOnUiThread {
            toast("تم الحفظ في مجلد التنزيلات")
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"; putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }, "مشاركة الملف"))
        }
    }
}
