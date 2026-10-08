import { useState } from "react";
import { toast } from "sonner";
import { CornerDownLeft, Forward, MessageSquareReply, Send } from "lucide-react";
import {
  COMPLAINT_NOTE_MAX,
  COMPLAINT_REFERRAL_MAX,
  COMPLAINT_REFERRAL_ROLES,
  awaitsReply,
  referralsTo,
  sortComplaints,
  type Complaint,
  type ComplaintReferral,
} from "@shared/complaints";
import { ROLE_LABELS, type UserProfile, type UserRole } from "@shared/users";
import { replyToReferral, stampText } from "@/lib/complaints";
import { useComplaints } from "@/lib/useShared";
import { ComplaintRow, ComplaintView } from "./Complaints";
import { Badge, Panel, btn, cx, inputClass, labelClass } from "./ui-kit";

const roleText = (role?: string) => (role ? ROLE_LABELS[role as UserRole] ?? "" : "");

/** شارة آخر تحويل في قائمة الشكاوى: محوّلة إلى فلان، أو رد فلان */
export function ReferralBadge({ complaint }: { complaint: Complaint }) {
  const last = complaint.referrals?.[complaint.referrals.length - 1];
  if (!last) return null;
  return last.reply
    ? <Badge tone="green" icon={MessageSquareReply}>رد {last.replyBy ?? last.toName}</Badge>
    : <Badge tone="violet" icon={Forward}>محوّلة إلى {last.toName ?? "…"}</Badge>;
}

/**
 * التحويلات في نافذة الشكوى: المدير يرى كلها، والمحوَّل إليه ما حُوّل إليه فقط مع الرد عليه (مرة واحدة).
 */
export function ReferralsSection({ complaint, admin, uid, onReply }: {
  complaint: Complaint;
  admin: boolean;
  uid?: string;
  onReply?: (index: number, reply: string) => void;
}) {
  const shown = admin ? (complaint.referrals ?? []).map((referral, index) => ({ referral, index })) : referralsTo(complaint, uid);
  if (!shown.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-500">{admin ? "التحويلات والردود" : "حُوّلت إليك"}</p>
      {shown.map(({ referral, index }) => (
        <ReferralCard key={index} referral={referral} canReply={!admin && !!onReply && referral.to === uid && !referral.reply} onReply={(reply) => onReply?.(index, reply)} />
      ))}
    </div>
  );
}

function ReferralCard({ referral, canReply, onReply }: { referral: ComplaintReferral; canReply: boolean; onReply: (reply: string) => void }) {
  const [reply, setReply] = useState("");
  return (
    <div className="rounded-xl bg-violet-50/60 px-3.5 py-3 text-sm ring-1 ring-inset ring-violet-200" data-testid="complaint-referral">
      <p className="flex flex-wrap items-center gap-x-2 font-semibold text-violet-900">
        <Forward className="h-4 w-4 shrink-0" /> إلى {referral.toName ?? "…"}
        {roleText(referral.toRole) && <span className="text-xs font-normal text-violet-800/80">({roleText(referral.toRole)})</span>}
      </p>
      <p className="mt-1 whitespace-pre-wrap leading-6 text-ink">{referral.note}</p>
      <p className="mt-1 text-xs text-slate-500">{["حوّلها " + (referral.by ?? "مدير النظام"), stampText(referral.at)].filter(Boolean).join(" · ")}</p>
      {referral.reply ? (
        <div className="mt-2 rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-emerald-200">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><MessageSquareReply className="h-3.5 w-3.5" /> الرد</p>
          <p className="mt-0.5 whitespace-pre-wrap leading-6 text-ink">{referral.reply}</p>
          <p className="mt-0.5 text-xs text-slate-500">{[referral.replyBy, stampText(referral.repliedAt)].filter(Boolean).join(" · ")}</p>
        </div>
      ) : canReply ? (
        <form
          onSubmit={(event) => { event.preventDefault(); if (reply.trim()) onReply(reply.trim()); }}
          className="mt-2 space-y-2"
        >
          <label className="block">
            <span className={labelClass}>ردك (ماذا تم؟)</span>
            <textarea value={reply} maxLength={COMPLAINT_NOTE_MAX} rows={3} onChange={(event) => setReply(event.target.value)} className={cx(inputClass, "h-auto bg-white py-2.5 leading-6")} />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">يصل الرد إلى مدير النظام، ولا يُعدّل بعد إرساله</span>
            <button type="submit" disabled={!reply.trim()} className={btn("primary", "sm")}><Send className="h-3.5 w-3.5" /> إرسال الرد</button>
          </div>
        </form>
      ) : (
        <p className="mt-1.5 text-xs font-medium text-amber-700">بانتظار الرد</p>
      )}
    </div>
  );
}

/** من تُحوَّل إليه الشكوى: المشرف الذي سجّلها أولًا (ليخبر الضيف)، ثم مسؤول العيادة ومشرفو المباني وغيرهم */
function referTargets(complaint: Complaint, users: UserProfile[]) {
  const order = COMPLAINT_REFERRAL_ROLES as readonly string[];
  const eligible = users.filter((user) => user.active && order.includes(user.role));
  const author = eligible.find((user) => user.uid === complaint.createdBy);
  const others = eligible.filter((user) => user !== author)
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.displayName.localeCompare(b.displayName, "ar"));
  return { author, groups: order.map((role) => ({ role, users: others.filter((user) => user.role === role) })).filter((group) => group.users.length) };
}

/** المدير: تحويل الشكوى إلى المعني بها مع ملاحظة */
export function ReferForm({ complaint, users, onRefer, onCancel }: {
  complaint: Complaint;
  users: UserProfile[] | null;
  onRefer: (to: string, note: string) => void;
  onCancel: () => void;
}) {
  const targets = referTargets(complaint, users ?? []);
  const [to, setTo] = useState(targets.author?.uid ?? "");
  const [note, setNote] = useState("");
  const full = (complaint.referrals?.length ?? 0) >= COMPLAINT_REFERRAL_MAX;
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); if (to && note.trim() && !full) onRefer(to, note.trim()); }}
      className="space-y-2 rounded-xl bg-violet-50/60 p-3 ring-1 ring-inset ring-violet-200"
    >
      <label className="block">
        <span className={labelClass}>تحويل الشكوى إلى</span>
        <select value={to} onChange={(event) => setTo(event.target.value)} disabled={!users} className={inputClass} aria-label="تحويل الشكوى إلى">
          <option value="">{users ? "اختر المعني بالشكوى" : "جارٍ تحميل الحسابات…"}</option>
          {targets.author && <option value={targets.author.uid}>المشرف الذي سجّلها: {targets.author.displayName} (ليخبر الضيف)</option>}
          {targets.groups.map((group) => (
            <optgroup key={group.role} label={roleText(group.role)}>
              {group.users.map((user) => <option key={user.uid} value={user.uid}>{user.displayName}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>الملاحظة</span>
        <textarea
          autoFocus
          value={note}
          maxLength={COMPLAINT_NOTE_MAX}
          rows={3}
          placeholder="ما المطلوب منه؟ مثل: يرجى التحقق مع العيادة والرد، أو أخبر الضيف بما تم"
          onChange={(event) => setNote(event.target.value)}
          className={cx(inputClass, "h-auto bg-white py-2.5 leading-6")}
        />
      </label>
      {full && <p role="alert" className="text-xs font-medium text-red-700">حُوّلت الشكوى {COMPLAINT_REFERRAL_MAX} مرات، وهذا الحد الأقصى</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btn("ghost", "sm")}>إلغاء</button>
        <button type="submit" disabled={!to || !note.trim() || full} className={btn("primary", "sm")}><Forward className="h-3.5 w-3.5" /> تحويل</button>
      </div>
    </form>
  );
}

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
