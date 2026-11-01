# Proofbycode · Mô phỏng Vietlott

Công cụ nghiên cứu và mô phỏng Mega 6/45 bằng JavaScript thuần.

Dự án cung cấp:

- mô phỏng sinh các bộ 6 số thực tế với seed có thể tái lập;
- giao diện trình duyệt chạy cục bộ bằng Web Worker;
- CLI Node.js để mô phỏng nhiều người chơi cho một bộ số mục tiêu cố định;
- phân tích bộ số cố định trên dữ liệu lịch sử Mega 6/45;
- tính phí theo mô hình bao phủ tổ hợp toán học.

Đây là dự án phục vụ học tập, kiểm chứng thuật toán và nghiên cứu dữ liệu. Kết quả mô phỏng không phải lời khuyên tài chính, không dự đoán kết quả tương lai và không đảm bảo lợi nhuận.

## Bắt đầu nhanh

Yêu cầu Node.js 18 trở lên. Dự án không có dependency bên ngoài.

```text
npm test
npm run serve
```

Sau đó mở `http://localhost:4173/`.

Không mở `index.html` trực tiếp bằng `file://`, vì ES modules, Web Worker và dữ liệu JSON cần được tải qua HTTP.

## Giao diện trình duyệt

Giao diện tĩnh có hai khu vực:

### Mô phỏng

- Chọn thủ công hoặc chọn ngẫu nhiên từ 2 đến 6 số.
- Chọn bộ số mục tiêu từ một kỳ quay lịch sử.
- Sinh từng bộ 6 số thực tế cho đến khi chứa toàn bộ số mục tiêu.
- Chạy trong Web Worker để giao diện vẫn phản hồi.
- Tạm dừng, tiếp tục, kết thúc và chạy lại cùng seed.
- Hiển thị seed, xác suất lý thuyết, số lượt đã thử, bộ số khớp và thời gian hoạt động.
- Sao chép hoặc tải kết quả.

### Tra lịch sử

- Phân tích 1–6 số đã chọn theo chế độ `contains-selected`.
- Lọc theo khoảng ngày bao gồm cả hai đầu mút.
- Hiển thị đầy đủ bộ 6 số của các kỳ khớp.
- Hiển thị tần suất lịch sử, xác suất lý thuyết, histogram giao nhau và khoảng cách giữa các lần khớp.
- Tự đặt ngày đầu/cuối theo dữ liệu đang có và báo số kỳ trong khoảng đã chọn.

Giao diện dùng các đường dẫn tương đối nên có thể chạy tại GitHub Pages dưới đường dẫn `/proofbycode-vietlott/` khi repository đã bật Pages. Workflow triển khai nằm tại `.github/workflows/pages.yml`.

## Mô hình tính phí

Mỗi bộ 6 số được quy ước giá `10.000 VNĐ`. Nếu chọn `k` số, một lượt mô phỏng được xem là một gói bao phủ tất cả các bộ 6 số chứa các số đã chọn:

```text
số bộ mỗi lượt = C(45 - k, 6 - k)
phí mỗi lượt = số bộ mỗi lượt × 10.000 VNĐ
tổng phí = số lượt đã thử × phí mỗi lượt
```

| Số đã chọn | Bộ 6 số trong một lượt | Phí mỗi lượt |
|---:|---:|---:|
| 6 | 1 | 10.000 VNĐ |
| 5 | 40 | 400.000 VNĐ |
| 4 | 820 | 8.200.000 VNĐ |
| 3 | 11.480 | 114.800.000 VNĐ |
| 2 | 123.410 | 1.234.100.000 VNĐ |

Đây là mô hình bao phủ toán học của dự án, không phải danh sách xác nhận các sản phẩm Bao bán lẻ chính thức của Vietlott. Tổng phí bao gồm cả lượt khớp cuối và chỉ là chi phí quan sát trong một lần mô phỏng. Không tính giải phụ, thuế, chia Jackpot, hạn mức mua vé hoặc các điều kiện thương mại thực tế.

## CLI mô phỏng nhiều người chơi

CLI mô phỏng nhiều người chơi cùng tham gia một kỳ quay có bộ số mục tiêu cố định:

```text
node scripts/simulate.js \
  --target 1,2,3,4,5,6 \
  --sets-per-player 1 \
  --stop-after-winners 1 \
  --seed demo-001
```

Xem toàn bộ tham số:

```text
node scripts/simulate.js --help
```

CLI:

- in cấu hình lúc khởi động;
- in tiến độ được giới hạn khoảng một lần mỗi giây;
- in winner event và bản tóm tắt cuối;
- đo thời gian và tốc độ sinh candidate ở ngoài core;
- dừng sau khoảng 10 giây nếu chưa hoàn thành;
- xử lý `Ctrl+C` và in snapshot hiện tại với trạng thái bị gián đoạn;
- không in từng bộ số.

`createSimulation()` ở core vẫn yêu cầu `maxPlayers` để bảo vệ giới hạn số học; CLI tự dùng mức trần an toàn và giới hạn thực tế bằng timeout 10 giây.

## CLI phân tích dữ liệu lịch sử

Dữ liệu mặc định nằm tại `data/mega-6-45.json`.

### Tìm các kỳ chứa toàn bộ số đã chọn

```text
node scripts/analyze-history.js \
  --mode contains-selected \
  --numbers 3,12,27
```

`contains-selected` nhận 1–6 số. Một kỳ khớp khi chứa tất cả số đã chọn. Chỉ trường hợp chọn đủ 6 số mới có thể xem là so khớp Jackpot; chọn ít hơn 6 số chỉ đo mức xuất hiện của một tập con.

### Mô hình bao phủ kết quả

```text
node scripts/analyze-history.js \
  --mode jackpot-coverage \
  --numbers 1,5,9,14,22,30,37,45 \
  --from 2020-01-01 \
  --to 2026-10-31
```

`jackpot-coverage` nhận 6–45 số và giả định người chơi mua toàn bộ `C(k, 6)` bộ 6 số trong tập đã chọn. Đây là mô hình toán học, không khẳng định mọi kích thước tập đều là sản phẩm bán vé chính thức.

Tùy chọn CLI:

```text
--mode <mode>       contains-selected hoặc jackpot-coverage
--numbers <list>    Danh sách số, phân cách bằng dấu phẩy
--from <date>       Ngày bắt đầu, YYYY-MM-DD, bao gồm
--to <date>         Ngày kết thúc, YYYY-MM-DD, bao gồm
--data <path>       Đường dẫn dataset JSON khác
--json              In toàn bộ kết quả dạng JSON
--help              In hướng dẫn
```

Kết quả gồm số kỳ phân tích, tỷ lệ khớp, histogram giao nhau từ 0 đến 6, các kỳ khớp và báo cáo khoảng cách. Số lượt chuyển giữa các kỳ và số ngày lịch là hai đại lượng khác nhau. Khoảng trước lần khớp đầu và sau lần khớp cuối là biên cửa sổ quan sát, không phải khoảng chờ đã hoàn tất.

## API JavaScript

### Mô phỏng một lượt trong trình duyệt

```js
import { createAttemptSimulation } from './src/attempt-simulation.js';

const simulation = createAttemptSimulation({
  target: [3, 12, 27],
  seed: 'demo-001',
});

let snapshot = simulation.getSnapshot();
while (snapshot.status === 'ready' || snapshot.status === 'running') {
  snapshot = simulation.advance({ maxCandidateGenerations: 10_000 });
}

console.log(snapshot);
```

API này sinh bộ 6 số thực tế và khớp khi bộ sinh chứa toàn bộ target. Target gồm 2–6 số, thứ tự không ảnh hưởng. Snapshot có các trạng thái `ready`, `running`, `paused`, `matched`, `stopped` và `error`.

Helper tính phí:

```js
import { calculateCoverageCost } from './src/attempt-simulation.js';

calculateCoverageCost(5);
// {
//   selectedCount: 5,
//   coveredSetsPerAttempt: 40,
//   costPerAttemptVnd: 400000
// }
```

### Mô phỏng nhiều người chơi

```js
import { createSimulation } from './src/simulation.js';

const simulation = createSimulation({
  target: [1, 2, 3, 4, 5, 6],
  setsPerPlayer: 1,
  stopAfterWinners: 1,
  maxPlayers: 20_000_000,
  seed: 'demo-001',
});

let snapshot = simulation.getSnapshot();
while (snapshot.status !== 'completed') {
  snapshot = simulation.advance({ maxCandidateGenerations: 50_000 });
}

console.log(snapshot);
```

Đặc điểm của engine:

- target phải có đúng 6 số nguyên phân biệt trong `[1, 45]`;
- mỗi player mua `setsPerPlayer` bộ phân biệt;
- các player khác nhau có thể mua cùng một bộ;
- sau khi player thắng, engine bỏ qua các bộ còn lại nhưng vẫn tính đủ số bộ đã mua;
- `totalSetsChecked` bao gồm cả bộ thắng;
- `candidateGenerations` bao gồm cả candidate bị loại do trùng trong player hiện tại;
- có thể xử lý incremental bằng các batch khác nhau mà vẫn cho cùng kết quả với cùng seed.

Tất cả player trong một lần chạy đại diện cho người tham gia cùng một kỳ quay và cùng một target cố định. Một lần chạy là một waiting count quan sát được, không phải ngưỡng dân số đảm bảo và không phải ước lượng xác suất.

## Seed và tính tái lập

PRNG dùng:

- seed chuỗi UTF-8 bắt buộc;
- hash FNV-1a;
- xorshift32;
- bounded sampling bằng rejection sampling không thiên lệch.

Cùng seed, cấu hình và phiên bản engine sẽ tái lập cùng kết quả. PRNG này chỉ dành cho mô phỏng, không dùng cho mật mã hoặc mục đích bảo mật.

## Dữ liệu lịch sử

Dataset hiện tại là `data/mega-6-45.json` với schema:

```json
{
  "source": "...",
  "retrievedAt": "YYYY-MM-DD",
  "draws": [
    {
      "id": "00001",
      "date": "YYYY-MM-DD",
      "result": [1, 2, 3, 4, 5, 6]
    }
  ]
}
```

Adapter chuẩn hóa thành:

```js
{
  drawId: '00001',
  drawDate: 'YYYY-MM-DD',
  numbers: [1, 2, 3, 4, 5, 6]
}
```

Adapter kiểm tra nghiêm ngặt ngày, sáu số phân biệt, ID trùng, record xung đột và tính liên tục nội bộ của ID. Không tự loại record lỗi hoặc tự deduplicate. Ngày được xử lý như ngày lịch, không chuyển qua timezone. Dataset hiện có 1.582 record với ID nội bộ liên tục `00001–01582`, nhưng trạng thái đầy đủ toàn bộ lịch sử bên ngoài vẫn là `unknown` vì không có manifest chính thức để xác minh.

Nguồn dataset được ghi trong metadata của file và được dùng offline; test không phụ thuộc mạng. Dự án không có crawler.

## Giới hạn hiệu năng

- Engine sinh và so sánh combination thật, không lấy winner count hoặc waiting time trực tiếp từ công thức xác suất.
- Rejection sampling trong cùng một player trở nên đắt khi `setsPerPlayer` tiến gần `8.145.060`, vì candidate trùng xuất hiện ngày càng nhiều.
- Bộ rank đã chấp nhận của player hiện tại cần bộ nhớ tỷ lệ với `setsPerPlayer`.
- Mô phỏng browser có thể chạy rất lâu với target 6 số; hãy dùng seed và theo dõi trạng thái thay vì chờ Jackpot thực tế.
- Xác suất lý thuyết và tần suất lịch sử được giữ riêng. Chọn số sau khi xem lịch sử tạo selection bias và không chứng minh lợi thế dự đoán.

## Cấu trúc repository

```text
.
├── data/                  Dataset Mega 6/45 cục bộ
├── index.html             Giao diện browser
├── scripts/
│   ├── analyze-history.js CLI phân tích lịch sử
│   ├── serve.js           HTTP server cục bộ
│   └── simulate.js        CLI mô phỏng nhiều người chơi
├── src/
│   ├── app.js             Logic giao diện
│   ├── attempt-simulation.js
│   ├── history-analysis.js
│   ├── history-data.js
│   ├── simulation-worker.js
│   └── simulation.js      Engine mô phỏng core
├── test/                  Test Node.js built-in
└── LICENSE
```

## Kiểm thử

```text
npm test
```

Test dùng `node:test` và `node:assert`, bao gồm validation, tổ hợp, seed tái lập, duplicate rejection, trạng thái incremental, phân tích lịch sử, date filtering, waiting gaps, xác suất và mô hình chi phí.

## Giấy phép

Xem [LICENSE](LICENSE).

Dữ liệu lịch sử và các nguồn bên ngoài có thể có điều khoản riêng; hãy kiểm tra metadata/source trước khi tái phân phối dataset.
