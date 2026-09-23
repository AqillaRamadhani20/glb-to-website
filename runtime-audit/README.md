# Runtime audit

Paket ini mendokumentasikan integritas aset dan hasil QA viewer. Approval Form dan Runtime sengaja tetap 'pending': model Blender tidak diubah atau diaudit ulang secara artistik, dan aplikasi belum dideploy.

Validasi lokal:

    npm run inspect:model
    npm run typecheck
    npm run build
    npm run smoke

'validate_room.py' dari skill tidak dijalankan karena Python tidak tersedia di environment ini. Pemeriksaan setara yang relevan untuk viewer dilakukan oleh 'inspect:model' dan 'smoke'.
