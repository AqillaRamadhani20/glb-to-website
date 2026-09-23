# Terminal 1 Juanda - Indoor Wayfinding 3D

Viewer Ground Floor berbasis Next.js, React Three Fiber, dan Three.js.

Asset runtime utama:

- `public/models/buildings-ground-floor.glb`, salinan identik dari `BUILDINGS 3D TERBARU.glb`.
- `public/navigation/navigation-graph-ground-floor.svg`, salinan identik dari `NAVIGATION_GRAPH (2).svg`.

GLB dimuat pada transform dan skala final dari Blender. Geometry, hierarchy, object name, posisi individual, dan material sumber tidak dimutasi. Material di-clone per render mesh, lalu palette dan highlight selection diterapkan hanya saat runtime. Audit coverage memastikan seluruh 656 material slot, termasuk lantai, memperoleh warna.

## Menjalankan proyek

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

## Kontrol

- `Set Start`, lalu klik node/POI asli pada map: simpan titik awal dan tampilkan marker `YOU ARE HERE`.
- Klik building `T1-GF-*` atau `TI-GF-*`, lalu `Route Here`: jalankan Dijkstra dan tampilkan marker `DESTINATION`.
- `Route Here` memulai sesi Visitor POV otomatis dengan kamera setinggi mata yang bergerak mengikuti polyline edge asli.
- Route aktif ditampilkan sebagai ribbon biru tebal di lantai dengan outline putih, marker posisi bergerak, dan label POI di sekitar jalur.
- HUD route menampilkan arah berikutnya, jarak ke manuver, sisa jarak, estimasi waktu, segmen, dan progress.
- `Overview`, `Pause/Resume`, `Recenter`, `Restart`, dan `End Route` mengontrol sesi tanpa WASD.
- `Map View`: kembali ke overview jalur atau kamera peta.
- `Reset Route`: hapus start dan destination.
- Klik kiri + drag: pan.
- Klik kanan + drag: orbit.
- Scroll / pinch: zoom.
- `R`: reset view.
- `D`: toggle debug navigation.
- `Esc`: tutup detail building.

## Navigation graph

Parser mempertahankan ID POI semantic dari SVG, menghasilkan ID stabil untuk node dan edge generik, lalu mencocokkan endpoint edge ke node terdekat dengan hard tolerance 20 SVG unit. Edge yang gagal match dilaporkan dan tidak dimasukkan ke adjacency graph. Dijkstra hanya menggunakan edge asli SVG dengan Euclidean weight.

Satu transform global SVG ke world dikalibrasi saat runtime dari POI/building semantic yang sama. Axis hasil inspeksi adalah SVG +X ke world +X dan SVG +Y ke world +Z. Tidak ada koreksi node individual.

Renderer memakai `frameloop="demand"`, instancing untuk node, buffer gabungan untuk edge debug, batas DPR adaptif, dan cache HTTP tervalidasi untuk asset GLB/SVG agar interaksi tetap ringan tanpa menghapus detail model.

Set `NEXT_PUBLIC_DEBUG_NAVIGATION=true` untuk menyalakan debug saat aplikasi dimuat. Dalam UI, tombol bug atau tombol `D` dapat mengubah mode debug sementara.

## Verifikasi

```bash
npm run audit:assets
npm run inspect:model
npm run typecheck
npm run build
npm run smoke
```
