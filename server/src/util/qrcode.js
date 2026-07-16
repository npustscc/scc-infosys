// server/src/util/qrcode.js — 手刻 QR code 編碼器（零外部依賴，CLAUDE.md 禁止為此新增 npm 套件，
// 含 QR code library）。忠實移植 Kazuhiko Arase 的 qrcode-generator（MIT license，
// https://github.com/kazuhikoarase/qrcode-generator，業界最常見的 vanilla-JS QR 編碼器移植來源，
// 被 davidshimjs/qrcodejs 等無數專案內嵌沿用）。Reed-Solomon 糾錯碼／BCH 格式資訊／版本資訊／
// 遮罩選擇（getLostPoint 8 種遮罩評分取最佳）皆逐字對映原演算法，不是「看起來像 QR code」的
// 簡化示意圖——尺寸/糾錯碼算錯會讓使用者掃不出來。
//
// 刻意的移植取捨（見任務回報「QR 演算法移植來源說明」）：
//   - 只做 byte mode（UTF-8 位元組模式），不做 numeric/alphanumeric/kanji 模式——本模組唯一用途是
//     TOTP 設定畫面的 otpauth:// URI（純 ASCII），不需要其餘模式節省空間的最佳化。
//   - 版本（type number）0 表示自動選擇：從 1 試到 39，選第一個裝得下資料的版本（對映原演算法
//     make() 的自動選版邏輯；原演算法本身在 1~39 都裝不下時不會再嘗試版本 40，此為原演算法既有
//     行為，非本次移植新增的限制——otpauth URI 長度遠低於版本 39 的容量上限，不受影響）。
//   - 糾錯等級固定可選 L/M/Q/H，供呼叫端指定；totpSetup 使用情境固定用 M（見 actions/totpSetup 呼叫處）。
//
// 同一份演算法程式碼須同時能被 Node（CommonJS require）與瀏覽器（server/login.html 內嵌
// <script>）使用——用 UMD 包裝（偵測 `module` 是否存在）達成「兩邊程式碼體逐字相同，只有模組
// 包裝方式不同」：login.html 內嵌的 <script> 是本檔內容的逐字複製貼上，不是另一份改寫。
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QRCodeGen = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── QRMath：GF(256) 對數/指數表（Reed-Solomon 運算的伽羅瓦體算術基礎）──

  var QRMath = {
    glog: function (n) {
      if (n < 1) throw new Error('glog(' + n + ')');
      return QRMath.LOG_TABLE[n];
    },
    gexp: function (n) {
      while (n < 0) n += 255;
      while (n >= 256) n -= 255;
      return QRMath.EXP_TABLE[n];
    },
    EXP_TABLE: new Array(256),
    LOG_TABLE: new Array(256),
  };
  for (var qi = 0; qi < 8; qi += 1) QRMath.EXP_TABLE[qi] = 1 << qi;
  for (var qj = 8; qj < 256; qj += 1) {
    QRMath.EXP_TABLE[qj] = QRMath.EXP_TABLE[qj - 4] ^ QRMath.EXP_TABLE[qj - 5]
      ^ QRMath.EXP_TABLE[qj - 6] ^ QRMath.EXP_TABLE[qj - 8];
  }
  for (var qk = 0; qk < 255; qk += 1) QRMath.LOG_TABLE[QRMath.EXP_TABLE[qk]] = qk;

  // ── 多項式（GF(256) 係數）：Reed-Solomon 糾錯碼生成與資料多項式取模用 ──

  function qrPolynomial(num, shift) {
    if (num.length === undefined) throw new Error(num.length + '/' + shift);
    var offset = 0;
    while (offset < num.length && num[offset] === 0) offset += 1;
    var _num = new Array(num.length - offset + shift);
    for (var i = 0; i < num.length - offset; i += 1) _num[i] = num[i + offset];

    var _this = {};
    _this.getAt = function (index) { return _num[index]; };
    _this.getLength = function () { return _num.length; };
    _this.multiply = function (e) {
      var out = new Array(_this.getLength() + e.getLength() - 1);
      for (var a = 0; a < out.length; a += 1) out[a] = 0;
      for (var a2 = 0; a2 < _this.getLength(); a2 += 1) {
        for (var b = 0; b < e.getLength(); b += 1) {
          out[a2 + b] ^= QRMath.gexp(QRMath.glog(_this.getAt(a2)) + QRMath.glog(e.getAt(b)));
        }
      }
      return qrPolynomial(out, 0);
    };
    _this.mod = function (e) {
      if (_this.getLength() - e.getLength() < 0) return _this;
      var ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
      var out = new Array(_this.getLength());
      for (var a3 = 0; a3 < _this.getLength(); a3 += 1) out[a3] = _this.getAt(a3);
      for (var a4 = 0; a4 < e.getLength(); a4 += 1) out[a4] ^= QRMath.gexp(QRMath.glog(e.getAt(a4)) + ratio);
      return qrPolynomial(out, 0).mod(e);
    };
    return _this;
  }

  // ── 常數：模式（本模組只實作 byte mode）／糾錯等級／遮罩型樣編號 ──

  var QRMode = { MODE_8BIT_BYTE: 1 << 2 };
  var QRErrorCorrectionLevel = { L: 1, M: 0, Q: 3, H: 2 };
  var QRMaskPattern = {
    PATTERN000: 0, PATTERN001: 1, PATTERN010: 2, PATTERN011: 3,
    PATTERN100: 4, PATTERN101: 5, PATTERN110: 6, PATTERN111: 7,
  };

  // ── QRUtil：BCH 格式/版本資訊編碼、對齊定位點座標表、8 種遮罩函式、遮罩評分（getLostPoint）──

  var QRUtil = (function () {
    // 版本 1~40 的對齊定位點座標（版本 1 無對齊定位點，故為空陣列）。
    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
      [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
      [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
      [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
    ];

    // BCH(15,5) 格式資訊生成多項式 0x537、BCH(18,6) 版本資訊生成多項式 0x1F25、格式資訊遮罩 0x5412
    // ——ISO/IEC 18004 固定常數，非本次移植自行推導。
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    function getBCHDigit(data) {
      var digit = 0;
      while (data !== 0) { digit += 1; data >>>= 1; }
      return digit;
    }

    var _this = {};

    _this.getBCHTypeInfo = function (data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15)));
      return ((data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function (data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18)));
      return (data << 12) | d;
    };

    _this.getPatternPosition = function (typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function (maskPattern) {
      switch (maskPattern) {
        case QRMaskPattern.PATTERN000: return function (i, j) { return (i + j) % 2 === 0; };
        case QRMaskPattern.PATTERN001: return function (i) { return i % 2 === 0; };
        case QRMaskPattern.PATTERN010: return function (i, j) { return j % 3 === 0; };
        case QRMaskPattern.PATTERN011: return function (i, j) { return (i + j) % 3 === 0; };
        case QRMaskPattern.PATTERN100: return function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; };
        case QRMaskPattern.PATTERN101: return function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; };
        case QRMaskPattern.PATTERN110: return function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; };
        case QRMaskPattern.PATTERN111: return function (i, j) { return ((i * j) % 3 + (i + j) % 2) % 2 === 0; };
        default: throw new Error('bad maskPattern:' + maskPattern);
      }
    };

    _this.getErrorCorrectPolynomial = function (errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
      return a;
    };

    // byte mode 的「字元計數」欄位位元數：版本 1-9／10-26／27-40 各不同（ISO/IEC 18004 Table 3）。
    _this.getLengthInBits = function (type) {
      if (type >= 1 && type < 10) return 8;
      if (type < 27) return 16;
      if (type < 41) return 16;
      throw new Error('type:' + type);
    };

    // 遮罩評分（4 條規則加總，越低越好）：LEVEL1 同色相鄰、LEVEL2 2x2 同色方塊、LEVEL3
    // 類定位點的 1:1:3:1:1 樣式、LEVEL4 深色比例偏離 50% 的程度。makeImpl 會對 8 種遮罩各算一次，
    // 取最低分者，避免深色/淺色模組過度連續造成掃描辨識率下降。
    _this.getLostPoint = function (qrCode) {
      var moduleCount = qrCode.getModuleCount();
      var lostPoint = 0;

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {
          var sameCount = 0;
          var dark = qrCode.isDark(row, col);
          for (var r = -1; r <= 1; r += 1) {
            if (row + r < 0 || moduleCount <= row + r) continue;
            for (var c = -1; c <= 1; c += 1) {
              if (col + c < 0 || moduleCount <= col + c) continue;
              if (r === 0 && c === 0) continue;
              if (dark === qrCode.isDark(row + r, col + c)) sameCount += 1;
            }
          }
          if (sameCount > 5) lostPoint += (3 + sameCount - 5);
        }
      }

      for (var row2 = 0; row2 < moduleCount - 1; row2 += 1) {
        for (var col2 = 0; col2 < moduleCount - 1; col2 += 1) {
          var count = 0;
          if (qrCode.isDark(row2, col2)) count += 1;
          if (qrCode.isDark(row2 + 1, col2)) count += 1;
          if (qrCode.isDark(row2, col2 + 1)) count += 1;
          if (qrCode.isDark(row2 + 1, col2 + 1)) count += 1;
          if (count === 0 || count === 4) lostPoint += 3;
        }
      }

      for (var row3 = 0; row3 < moduleCount; row3 += 1) {
        for (var col3 = 0; col3 < moduleCount - 6; col3 += 1) {
          if (qrCode.isDark(row3, col3) && !qrCode.isDark(row3, col3 + 1) && qrCode.isDark(row3, col3 + 2)
            && qrCode.isDark(row3, col3 + 3) && qrCode.isDark(row3, col3 + 4) && !qrCode.isDark(row3, col3 + 5)
            && qrCode.isDark(row3, col3 + 6)) {
            lostPoint += 40;
          }
        }
      }
      for (var col4 = 0; col4 < moduleCount; col4 += 1) {
        for (var row4 = 0; row4 < moduleCount - 6; row4 += 1) {
          if (qrCode.isDark(row4, col4) && !qrCode.isDark(row4 + 1, col4) && qrCode.isDark(row4 + 2, col4)
            && qrCode.isDark(row4 + 3, col4) && qrCode.isDark(row4 + 4, col4) && !qrCode.isDark(row4 + 5, col4)
            && qrCode.isDark(row4 + 6, col4)) {
            lostPoint += 40;
          }
        }
      }

      var darkCount = 0;
      for (var col5 = 0; col5 < moduleCount; col5 += 1) {
        for (var row5 = 0; row5 < moduleCount; row5 += 1) {
          if (qrCode.isDark(row5, col5)) darkCount += 1;
        }
      }
      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }());

  // ── QRRSBlock：各版本×糾錯等級的 Reed-Solomon 區塊切分表（ISO/IEC 18004 Table 9）。
  //    每列 [區塊數, 該區塊總碼字數, 該區塊資料碼字數] 重複出現（部分版本資料要切成兩種大小的區塊）。

  var QRRSBlock = (function () {
    var RS_BLOCK_TABLE = [
      [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
      [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
      [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
      [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
      [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
      [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
      [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
      [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
      [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
      [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
      [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
      [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
      [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
      [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
      [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13],
      [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
      [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
      [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
      [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
      [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16],
      [4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17],
      [2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13],
      [4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16],
      [6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17],
      [8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16],
      [10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17],
      [8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16],
      [3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16],
      [7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16],
      [5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16],
      [13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16],
      [17, 145, 115], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16],
      [17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16],
      [13, 145, 115, 6, 146, 116], [14, 74, 46, 23, 75, 47], [44, 54, 24, 7, 55, 25], [59, 46, 16, 1, 47, 17],
      [12, 151, 121, 7, 152, 122], [12, 75, 47, 26, 76, 48], [39, 54, 24, 14, 55, 25], [22, 45, 15, 41, 46, 16],
      [6, 151, 121, 14, 152, 122], [6, 75, 47, 34, 76, 48], [46, 54, 24, 10, 55, 25], [2, 45, 15, 64, 46, 16],
      [17, 152, 122, 4, 153, 123], [29, 74, 46, 14, 75, 47], [49, 54, 24, 10, 55, 25], [24, 45, 15, 46, 46, 16],
      [4, 152, 122, 18, 153, 123], [13, 74, 46, 32, 75, 47], [48, 54, 24, 14, 55, 25], [42, 45, 15, 32, 46, 16],
      [20, 147, 117, 4, 148, 118], [40, 75, 47, 7, 76, 48], [43, 54, 24, 22, 55, 25], [10, 45, 15, 67, 46, 16],
      [19, 148, 118, 6, 149, 119], [18, 75, 47, 31, 76, 48], [34, 54, 24, 34, 55, 25], [20, 45, 15, 61, 46, 16],
    ];

    function qrRSBlock(totalCount, dataCount) {
      return { totalCount: totalCount, dataCount: dataCount };
    }

    function getRsBlockTable(typeNumber, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case QRErrorCorrectionLevel.L: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
        case QRErrorCorrectionLevel.M: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
        case QRErrorCorrectionLevel.Q: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
        case QRErrorCorrectionLevel.H: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
        default: return undefined;
      }
    }

    var _this = {};
    _this.getRSBlocks = function (typeNumber, errorCorrectionLevel) {
      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
      if (rsBlock === undefined) {
        throw new Error('bad rs block @ typeNumber:' + typeNumber + '/errorCorrectionLevel:' + errorCorrectionLevel);
      }
      var length = rsBlock.length / 3;
      var list = [];
      for (var i = 0; i < length; i += 1) {
        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];
        for (var j = 0; j < count; j += 1) list.push(qrRSBlock(totalCount, dataCount));
      }
      return list;
    };
    return _this;
  }());

  // ── 位元緩衝區：把資料/長度欄位逐 bit 寫入位元組陣列（MSB-first）──

  function qrBitBuffer() {
    var _buffer = [];
    var _length = 0;
    var _this = {};
    _this.getBuffer = function () { return _buffer; };
    _this.getLengthInBits = function () { return _length; };
    _this.putBit = function (bit) {
      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) _buffer.push(0);
      if (bit) _buffer[bufIndex] |= (0x80 >>> (_length % 8));
      _length += 1;
    };
    _this.put = function (num, length) {
      for (var i = 0; i < length; i += 1) _this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    };
    return _this;
  }

  // ── UTF-8 編碼（不依賴 Buffer／TextEncoder，Node／瀏覽器通用，逐字元手刻含代理對組字）：
  //    otpauth URI 本身是純 ASCII，但完整支援 UTF-8 讓本模組不侷限於 TOTP 這個唯一用途。

  function utf8Bytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i += 1) {
      var code = str.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          code = ((code - 0xD800) * 0x400) + (next - 0xDC00) + 0x10000;
          i += 1;
        }
      }
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    }
    return bytes;
  }

  function qr8BitByte(data) {
    var _bytes = utf8Bytes(String(data));
    return {
      getMode: function () { return QRMode.MODE_8BIT_BYTE; },
      getLength: function () { return _bytes.length; },
      write: function (buffer) {
        for (var i = 0; i < _bytes.length; i += 1) buffer.put(_bytes[i], 8);
      },
    };
  }

  // ── 主體：對映原演算法 qrcode(typeNumber, errorCorrectionLevel) ──

  var PAD0 = 0xEC;
  var PAD1 = 0x11;

  function newQRCode(typeNumber, errorCorrectionLevel) {
    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];
    var _this = {};

    function setupPositionProbePattern(row, col) {
      for (var r = -1; r <= 7; r += 1) {
        if (row + r <= -1 || _moduleCount <= row + r) continue;
        for (var c = -1; c <= 7; c += 1) {
          if (col + c <= -1 || _moduleCount <= col + c) continue;
          if ((0 <= r && r <= 6 && (c === 0 || c === 6))
            || (0 <= c && c <= 6 && (r === 0 || r === 6))
            || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    }

    function setupTimingPattern() {
      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) continue;
        _modules[r][6] = (r % 2 === 0);
      }
      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) continue;
        _modules[6][c] = (c % 2 === 0);
      }
    }

    function setupPositionAdjustPattern() {
      var pos = QRUtil.getPatternPosition(_typeNumber);
      for (var i = 0; i < pos.length; i += 1) {
        for (var j = 0; j < pos.length; j += 1) {
          var row = pos[i];
          var col = pos[j];
          if (_modules[row][col] != null) continue;
          for (var r = -2; r <= 2; r += 1) {
            for (var c = -2; c <= 2; c += 1) {
              if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    }

    function setupTypeNumber(test) {
      var bits = QRUtil.getBCHTypeNumber(_typeNumber);
      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ((bits >> i) & 1) === 1);
        _modules[Math.floor(i / 3)][(i % 3) + _moduleCount - 8 - 3] = mod;
      }
      for (var i2 = 0; i2 < 18; i2 += 1) {
        var mod2 = (!test && ((bits >> i2) & 1) === 1);
        _modules[(i2 % 3) + _moduleCount - 8 - 3][Math.floor(i2 / 3)] = mod2;
      }
    }

    function setupTypeInfo(test, maskPattern) {
      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      for (var i = 0; i < 15; i += 1) {
        var mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 6) _modules[i][8] = mod;
        else if (i < 8) _modules[i + 1][8] = mod;
        else _modules[_moduleCount - 15 + i][8] = mod;
      }
      for (var i2 = 0; i2 < 15; i2 += 1) {
        var mod2 = (!test && ((bits >> i2) & 1) === 1);
        if (i2 < 8) _modules[8][_moduleCount - i2 - 1] = mod2;
        else if (i2 < 9) _modules[8][15 - i2 - 1 + 1] = mod2;
        else _modules[8][15 - i2 - 1] = mod2;
      }
      _modules[_moduleCount - 8][8] = !test;
    }

    function mapData(data, maskPattern) {
      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {
        if (col === 6) col -= 1;
        for (;;) {
          for (var c = 0; c < 2; c += 1) {
            if (_modules[row][col - c] == null) {
              var dark = false;
              if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
              if (maskFunc(row, col - c)) dark = !dark;
              _modules[row][col - c] = dark;
              bitIndex -= 1;
              if (bitIndex === -1) { byteIndex += 1; bitIndex = 7; }
            }
          }
          row += inc;
          if (row < 0 || _moduleCount <= row) { row -= inc; inc = -inc; break; }
        }
      }
    }

    function createBytes(buffer, rsBlocks) {
      var offset = 0;
      var maxDcCount = 0;
      var maxEcCount = 0;
      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {
        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);
        for (var i = 0; i < dcdata[r].length; i += 1) dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var j = 0; j < ecdata[r].length; j += 1) {
          var modIndex = j + modPoly.getLength() - ecdata[r].length;
          ecdata[r][j] = (modIndex >= 0) ? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var t = 0; t < rsBlocks.length; t += 1) totalCodeCount += rsBlocks[t].totalCount;

      var out = new Array(totalCodeCount);
      var index = 0;
      for (var i2 = 0; i2 < maxDcCount; i2 += 1) {
        for (var r2 = 0; r2 < rsBlocks.length; r2 += 1) {
          if (i2 < dcdata[r2].length) { out[index] = dcdata[r2][i2]; index += 1; }
        }
      }
      for (var i3 = 0; i3 < maxEcCount; i3 += 1) {
        for (var r3 = 0; r3 < rsBlocks.length; r3 += 1) {
          if (i3 < ecdata[r3].length) { out[index] = ecdata[r3][i3]; index += 1; }
        }
      }
      return out;
    }

    function createData(typeNumber, errorCorrectionLevel, dataList) {
      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(typeNumber));
        data.write(buffer);
      }

      var totalDataCount = 0;
      for (var b = 0; b < rsBlocks.length; b += 1) totalDataCount += rsBlocks[b].dataCount;

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw new Error('code length overflow. (' + buffer.getLengthInBits() + '>' + (totalDataCount * 8) + ')');
      }
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
      while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
      for (;;) {
        if (buffer.getLengthInBits() >= totalDataCount * 8) break;
        buffer.put(PAD0, 8);
        if (buffer.getLengthInBits() >= totalDataCount * 8) break;
        buffer.put(PAD1, 8);
      }
      return createBytes(buffer, rsBlocks);
    }

    function makeImpl(test, maskPattern) {
      _moduleCount = _typeNumber * 4 + 17;
      _modules = new Array(_moduleCount);
      for (var row = 0; row < _moduleCount; row += 1) {
        _modules[row] = new Array(_moduleCount);
        for (var col = 0; col < _moduleCount; col += 1) _modules[row][col] = null;
      }

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);
      if (_typeNumber >= 7) setupTypeNumber(test);
      if (_dataCache == null) _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      mapData(_dataCache, maskPattern);
    }

    function getBestMaskPattern() {
      var minLostPoint = 0;
      var pattern = 0;
      for (var i = 0; i < 8; i += 1) {
        makeImpl(true, i);
        var lostPoint = QRUtil.getLostPoint(_this);
        if (i === 0 || minLostPoint > lostPoint) { minLostPoint = lostPoint; pattern = i; }
      }
      return pattern;
    }

    _this.addData = function (data) {
      _dataList.push(qr8BitByte(data));
      _dataCache = null;
    };

    _this.isDark = function (row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) throw new Error(row + ',' + col);
      return _modules[row][col];
    };

    _this.getModuleCount = function () { return _moduleCount; };

    // 版本自動選擇：typeNumber < 1 時，從版本 1 逐一試到 39，選第一個裝得下目前 _dataList 的版本
    // （對映原演算法 make() 的自動選版邏輯，含「不會再嘗試版本 40」這個原演算法既有行為）。
    _this.make = function () {
      if (_typeNumber < 1) {
        var typeNumber = 1;
        for (; typeNumber < 40; typeNumber += 1) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();
          for (var i = 0; i < _dataList.length; i += 1) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(typeNumber));
            data.write(buffer);
          }
          var totalDataCount = 0;
          for (var b = 0; b < rsBlocks.length; b += 1) totalDataCount += rsBlocks[b].dataCount;
          if (buffer.getLengthInBits() <= totalDataCount * 8) break;
        }
        _typeNumber = typeNumber;
      }
      makeImpl(false, getBestMaskPattern());
    };

    return _this;
  }

  // ── 對外友善 API：generate(text, ecLevel) 直接回傳矩陣（呼叫端只需要 moduleCount/matrix，
  //    不需要碰內部的 mode/mask/版本細節）。ecLevel 預設 'M'（totpSetup 使用情境的選擇）。

  function generate(text, ecLevel) {
    var qr = newQRCode(0, ecLevel || 'M');
    qr.addData(String(text == null ? '' : text));
    qr.make();
    var n = qr.getModuleCount();
    var matrix = new Array(n);
    for (var r = 0; r < n; r += 1) {
      var row = new Array(n);
      for (var c = 0; c < n; c += 1) row[c] = !!qr.isDark(r, c);
      matrix[r] = row;
    }
    return { moduleCount: n, matrix: matrix };
  }

  // ASCII art（自我驗證外觀用，見 test/qrcode.test.js 與任務回報的自我驗證說明）：全形方塊字元，
  // 深色模組印兩個字元寬避免終端機字型非正方形導致比例失真。
  function toAsciiArt(result) {
    var lines = [];
    for (var r = 0; r < result.moduleCount; r += 1) {
      var line = '';
      for (var c = 0; c < result.moduleCount; c += 1) line += result.matrix[r][c] ? '██' : '  ';
      lines.push(line);
    }
    return lines.join('\n');
  }

  return { generate: generate, toAsciiArt: toAsciiArt };
}));
