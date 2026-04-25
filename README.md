# Queue Display

Ung dung man hinh cho khu tiep nhan voi 2 giao dien:

- `/viewer`: chon hien 1 hoac 2 o thong tin trong 3 luong BHYT, Thu phi, Kham doan
- `/control`: chon luong can dieu khien, tang so, chinh so thu cong, sua cau doc va phat loa

## Chay du an

```bash
npm install
npm start
```

Mo:

- `http://localhost:3000/viewer`
- `http://localhost:3000/control`

## Phat loa

Them file `public/audio/sample-announcement.mp3` neu muon phat doan am thanh mau truoc khi doc so.

Moi luong co the dat cau doc rieng, vi du:

`Moi so thu tu {{number}} toi quay tiep nhan.`

He thong se thay `{{number}}` bang so dang hien cua luong duoc chon, sau do doc bang `SpeechSynthesis`.

Nut **Tang so** tren trang `/control` hien tai se:

- Tang so thu tu dang hien thi.
- Phat ngay am thanh goi cho so vua tang.
- Tu dong prewarm (tao san cache) audio cho **so tiep theo** neu chua ton tai.

## Goi y phat trien tiep theo

### 1) Toi uu hieu nang va do on dinh

- **Tien tao audio (prefetch)**: tao san file TTS cho so tiep theo (vd: `currentNumber + 1`) de bam "Moi so" la phat ngay.
- **Doi choi cache co TTL**: them co che xoa file cache qua han theo lich (cron job) de tranh day o dia.
- **Theo doi metric TTS**: log thoi gian tao audio, cache-hit/cache-miss, so request loi de danh gia chat luong theo thoi gian.
- **Hang doi phat loa**: neu bam lien tuc, dua vao queue de tranh chong cheo audio.

### 2) Nang cap tinh nang nghiep vu

- **Da quay tiep nhan trong 1 luong**: cho phep BHYT co nhieu quay (A1, A2, A3) va phan bo tu dong.
- **Lich su da goi so**: luu lich su moi lan announce (so, luong, thoi gian, nguoi thao tac) de doi soat.
- **Che do uu tien**: goi chen so uu tien/cap cuu ma khong mat thu tu he thong.

### 3) Van hanh va trien khai

- **Cau hinh qua `.env`**: dua cac gia tri nhu `PORT`, `TTS_PYTHON_PATH`, gioi han cache vao bien moi truong.
- **Dong bo du lieu ben ngoai**: bo sung Redis/PostgreSQL neu can chay da server.
- **Dong goi Docker**: tao Dockerfile + docker-compose de de trien khai tai benh vien/phong kham.
