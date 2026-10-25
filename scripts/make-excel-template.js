/** Generates templates/questions-template.xlsx with the expected Arabic headers + sample rows. */
const path = require('path');
const ExcelJS = require('exceljs');

const out = process.argv[2] || path.join(__dirname, '../templates/questions-template.xlsx');

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الأسئلة', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'السؤال', width: 50 },
    { header: 'أ', width: 20 }, { header: 'ب', width: 20 }, { header: 'ج', width: 20 }, { header: 'د', width: 20 },
    { header: 'الإجابة الصحيحة', width: 16 },
    { header: 'الشرح', width: 40 },
    { header: 'القانون/الملحوظة', width: 30 },
    { header: 'المادة', width: 14 },
    { header: 'الدرس', width: 20 },
    { header: 'نوع الدرس', width: 14 },
    { header: 'التصنيف', width: 14 },
    { header: 'سنة الامتحان', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  const rows = [
    ['جسم كتلته 2 كجم يتحرك بعجلة 3 م/ث². ما القوة المؤثرة عليه؟', '5 نيوتن', '6 نيوتن', '1.5 نيوتن', '9 نيوتن', 'ب', 'من قانون نيوتن الثاني ق = ك × جـ = 2 × 3 = 6 نيوتن', 'ق = ك × جـ', 'فيزياء', 'قوانين نيوتن', 'نظري', 'درس', ''],
    ['وحدة قياس الشغل هي:', 'الوات', 'النيوتن', 'الجول', 'الباسكال', 'ج', 'الشغل = القوة × الإزاحة ويقاس بالجول', 'الشغل = ق × ف', 'فيزياء', 'الشغل والطاقة', 'نظري', 'درس', ''],
    ['سرعة الضوء في الفراغ تقريباً:', '3×10^8 م/ث', '3×10^6 م/ث', '340 م/ث', '1500 م/ث', 'A', '', '', 'فيزياء', 'الضوء', 'حفظ', 'امتحان سابق', '2023'],
    ['العدد الذري للكربون هو:', '12', '6', '14', '8', 'ب', 'العدد الذري = عدد البروتونات = 6', '', 'كيمياء', 'التركيب الذري', 'حفظ', 'درس', ''],
    ['أي مما يلي غاز نبيل؟', 'الأكسجين', 'النيتروجين', 'الهيليوم', 'الهيدروجين', 'ج', '', 'الغازات النبيلة: المجموعة 18', 'كيمياء', 'الجدول الدوري', 'نظري', 'امتحان سابق', '2022'],
    ['ناتج 15% من 200 هو:', '15', '30', '20', '45', 'ب', '', '', 'رياضيات', 'النسبة المئوية', 'مسائل', 'درس', ''],
  ];
  rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(out);
  console.log(`✅ Template written to ${out}`);
})();
