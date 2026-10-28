import { useState } from "react";
import { toast } from "sonner";
import { CornerDownLeft } from "lucide-react";
import { awaitsReply, referralsTo, sortComplaints } from "@shared/complaints";
import { replyToReferral } from "@/lib/complaints";
import { useComplaints } from "@/lib/useShared";
import { ComplaintRow, ComplaintView } from "./Complaints";
import { Panel, btn } from "./ui-kit";

/**
 * «شكاوى محوّلة إليك»: لكل من حوّل إليه المدير شكوى (مسؤول العيادة، ومشرف المبنى، ومن سجّلها…)، والتي تنتظر رده أولًا.
 * لا يظهر إن لم تُحوَّل إليه شكوى.
 */
export function ReferredComplaints({ uid }: { uid: string }) {
  const complaints = useComplaints();
  const [openId, setOpenId] = useState<string | null>(null);
  const mine = sortComplaints(complaints.filter((complaint) => referralsTo(complaint, uid).length));
  const waiting = mine.filter((complaint) => awaitsReply(complaint, uid));
  const [showAnswered, setShowAnswered] = useState(false);
  if (!mine.length) return null;
  const shown = showAnswered ? mine : waiting;
  const opened = openId ? complaints.find((complaint) => complaint.id === openId) : undefined;
  return (
    <div dir="rtl" lang="ar" className="mb-5">
      <Panel
        id="referred-complaints"
        icon={CornerDownLeft}
        tone={waiting.length ? "amber" : "green"}
        title={waiting.length ? "شكاوى محوّلة إليك تنتظر ردك" : "شكاوى محوّلة إليك"}
        description="حوّلها مدير النظام إليك مع ملاحظة · اقرأ الشكوى واكتب ردك"
        count={waiting.length || undefined}
        actions={mine.length > waiting.length ? (
          <button type="button" onClick={() => setShowAnswered((value) => !value)} className={btn("ghost", "sm")}>
            {showAnswered ? "التي تنتظر ردك فقط" : `عرض الكل (${mine.length})`}
          </button>
        ) : undefined}
      >
        {shown.length ? (
          <div className="divide-y divide-slate-100">
            {shown.map((complaint) => <ComplaintRow key={complaint.id} complaint={complaint} showAuthor onOpen={() => setOpenId(complaint.id)} />)}
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-slate-500">رددت على كل الشكاوى المحوّلة إليك.</p>
        )}
      </Panel>
      {opened && (
        <ComplaintView
          complaint={opened}
          uid={uid}
          onReply={(index, reply) => { replyToReferral(opened.id, index, reply); toast.success(`أُرسل ردك على الشكوى #${opened.number}`); }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
