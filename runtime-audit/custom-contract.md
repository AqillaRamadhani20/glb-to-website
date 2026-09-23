# Kontrak runtime — Terminal 01

- Hero: file GLB pengguna sebagai satu-satunya sumber geometry.
- Transform: posisi, rotasi, skala, dan hierarchy node sumber dipertahankan.
- Identitas: 592 nama node GLB dipetakan ke 623 primitive render tanpa mengganti nama logis.
- Material: setiap render mesh menerima clone material sendiri; warna kategori hanya diterapkan pada clone runtime.
- Kamera: perspective camera buatan runtime, fit dari bounds, pan kiri, orbit kanan, wheel/pinch zoom, reset, dan tombol zoom.
- Wayfinding: pencarian exact source name memilih node logis dan memfokuskan bounds objek.
- Readiness: GLB termuat, hitungan 592 objek tampil, pencarian dan panel metadata berfungsi, gesture kamera tidak mengubah pilihan, viewport desktop/mobile lulus, dan console error kosong.
