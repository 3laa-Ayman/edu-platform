/**
 * Generates templates/questions-template.xlsx with the expected Arabic headers + sample rows,
 * including examples of pictures: one in the "صورة السؤال" column and four as answer options.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const out = process.argv[2] || path.join(__dirname, '../templates/questions-template.xlsx');
const img = (name) => fs.readFileSync(path.join(__dirname, '../templates/images', `${name}.png`));

const HEADERS = [
  ['السؤال', 50], ['صورة السؤال', 28],
  ['أ', 22], ['ب', 22], ['ج', 22], ['د', 22],
  ['الإجابة الصحيحة', 16], ['الشرح', 40], ['القانون/الملحوظة', 30],
  ['المادة', 14], ['الدرس', 20], ['نوع الدرس', 14], ['التصنيف', 14], ['سنة الامتحان', 12],
];
const COL = Object.fromEntries(HEADERS.map(([h], i) => [h, i])); // 0-based column index

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الأسئلة', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = HEADERS.map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true };

  const rows = [
    ['جسم كتلته 2 كجم يتحرك بعجلة 3 م/ث². ما القوة المؤثرة عليه؟', '', '5 نيوتن', '6 نيوتن', '1.5 نيوتن', '9 نيوتن', 'ب', 'من قانون نيوتن الثاني ق = ك × جـ = 2 × 3 = 6 نيوتن', 'ق = ك × جـ', 'فيزياء', 'قوانين نيوتن', 'نظري', 'درس', ''],
    ['وحدة قياس الشغل هي:', '', 'الوات', 'النيوتن', 'الجول', 'الباسكال', 'ج', 'الشغل = القوة × الإزاحة ويقاس بالجول', 'الشغل = ق × ف', 'فيزياء', 'الشغل والطاقة', 'نظري', 'درس', ''],
    ['سرعة الضوء في الفراغ تقريباً:', '', '3×10^8 م/ث', '3×10^6 م/ث', '340 م/ث', '1500 م/ث', 'A', '', '', 'فيزياء', 'الضوء', 'حفظ', 'امتحان سابق', '2023'],
    ['العدد الذري للكربون هو:', '', '12', '6', '14', '8', 'ب', 'العدد الذري = عدد البروتونات = 6', '', 'كيمياء', 'التركيب الذري', 'حفظ', 'درس', ''],
    ['أي مما يلي غاز نبيل؟', '', 'الأكسجين', 'النيتروجين', 'الهيليوم', 'الهيدروجين', 'ج', '', 'الغازات النبيلة: المجموعة 18', 'كيمياء', 'الجدول الدوري', 'نظري', 'امتحان سابق', '2022'],
    ['ناتج 15% من 200 هو:', '', '15', '30', '20', '45', 'ب', '', '', 'رياضيات', 'النسبة المئوية', 'مسائل', 'درس', ''],
    // Picture in the "صورة السؤال" column
    ['من الشكل: احسب طول الوتر في المثلث القائم.', '', '5', '6', '7', '12', 'أ', 'فيثاغورس: الوتر² = 3² + 4² = 25 ← الوتر = 5', 'الوتر² = ضلع² + ضلع²', 'رياضيات', 'نظرية فيثاغورس', 'مسائل', 'درس', ''],
    // Pictures as the four options (option text left empty)
    ['أي من الرسومات البيانية التالية يمثل علاقة طردية؟', '', '', '', '', '', 'أ', 'العلاقة الطردية خط مستقيم يمر بنقطة الأصل', 'ص = ك × س', 'رياضيات', 'التناسب', 'مسائل', 'درس', ''],
  ];
  rows.forEach((r) => ws.addRow(r));

  const place = (name, excelRow, colName, width, height) => {
    const id = wb.addImage({ buffer: img(name), extension: 'png' });
    ws.addImage(id, { tl: { col: COL[colName] + 0.1, row: excelRow - 1 + 0.1 }, ext: { width, height }, editAs: 'oneCell' });
  };
  ws.getRow(8).height = 120;
  place('triangle', 8, 'صورة السؤال', 160, 110);
  ws.getRow(9).height = 90;
  [['graph-a', 'أ'], ['graph-b', 'ب'], ['graph-c', 'ج'], ['graph-d', 'د']].forEach(([n, c]) => place(n, 9, c, 110, 82));

  await wb.xlsx.writeFile(out);
  console.log(`✅ Template written to ${out}`);
})();
