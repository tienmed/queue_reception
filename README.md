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
