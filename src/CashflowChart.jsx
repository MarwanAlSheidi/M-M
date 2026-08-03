import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

/*
 * رسم التدفق النقدي — مفصول في ملف مستقل لسبب تقني واحد: recharts تشكّل أغلب
 * حجم الحزمة (نحو 103ك مضغوطة) ولا تظهر إلا في شاشة «القراءة». فصلها يسمح
 * بتحميلها كسولاً عند الوصول إلى تلك الشاشة فقط، لا عند فتح التطبيق — والتطبيق
 * يُملأ على الجوال غالباً.
 *
 * المكوّن «أخرس» عمداً: لا يعرف الثابت T ولا دالة العملة، بل يستقبلهما كخصائص،
 * كي يبقى T أعلى khutta-maliya.jsx نقطة تبديل الهوية البصرية الوحيدة.
 */
export default function CashflowChart({ data, theme: T, formatter }) {
  return (
    <div dir="ltr" style={{ width:"100%", height:260 }}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
          <XAxis dataKey="name" tick={{ fontSize:11, fill:T.muted }} />
          <YAxis tick={{ fontSize:11, fill:T.muted }} />
          <Tooltip formatter={formatter} />
          <Legend wrapperStyle={{ fontSize:12, fontFamily:T.body }} />
          <Bar dataKey="تكلفة الأهداف (اسمية)" fill={T.ink} radius={[4,4,0,0]} />
          <Bar dataKey="المتاح فعلياً" fill={T.fillLine} radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
