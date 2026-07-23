import type { ConversationTurn, Speaker } from '@kibotalk/conversation'

export type ReplyEvalCase = {
  /** Stable id for vieval report compare (`benchmark.case.id`). */
  id: string
  level: string
  /** Short Chinese note for humans reading the fixture. */
  note: string
  turns: Array<{
    speaker: Speaker
    text: string
    sttFailed?: boolean
  }>
}

function toConversationTurns(
  turns: ReplyEvalCase['turns'],
): ConversationTurn[] {
  const base = 1_700_000_000_000
  return turns.map((turn, index) => ({
    id: `t${index + 1}`,
    speaker: turn.speaker,
    text: turn.text,
    startedAt: base + index * 5_000,
    endedAt: base + index * 5_000 + 2_000,
    sttFailed: turn.sttFailed,
  }))
}

/** Fixture cases for reply-suggestions prompt ablation. */
export const REPLY_EVAL_CASES: ReplyEvalCase[] = [
  {
    id: 'konbini-greeting-n5',
    level: 'N5',
    note: '便利店迎客，开场问候',
    turns: [
      { speaker: 'other', text: 'いらっしゃいませ。' },
    ],
  },
  {
    id: 'cafe-party-size-n4',
    level: 'N4',
    note: '咖啡店问人数',
    turns: [
      { speaker: 'other', text: 'いらっしゃいませ。何名様ですか？' },
    ],
  },
  {
    id: 'workplace-keigo-n2',
    level: 'N2',
    note: '职场敬语：同事请客休息',
    turns: [
      { speaker: 'other', text: 'お疲れ様です。少し休憩しませんか。' },
      { speaker: 'user', text: 'あ、はい…' },
      { speaker: 'other', text: 'コーヒーでもどうですか。' },
    ],
  },
  {
    id: 'stt-noisy-user-n5',
    level: 'N5',
    note: '用户 STT 噪声后对方追问',
    turns: [
      { speaker: 'other', text: '今日はどこへ行きますか。' },
      { speaker: 'user', text: 'え、あ、きょう は… うー…', sttFailed: false },
      { speaker: 'other', text: 'すみません、もう一度お願いします。' },
    ],
  },
  {
    id: 'apology-late-n4',
    level: 'N4',
    note: '迟到道歉场景',
    turns: [
      { speaker: 'other', text: '遅いよ。どうしたの？' },
    ],
  },
  {
    id: 'friend-plan-n5',
    level: 'N5',
    note: '朋友约周末',
    turns: [
      { speaker: 'other', text: '今週末、暇？' },
      { speaker: 'user', text: 'うん、たぶん大丈夫。' },
      { speaker: 'other', text: 'じゃあ一緒に映画見ない？' },
    ],
  },

  // ── 复杂多轮 / 高风险场景（均含 user 实际说过的话，影响下轮建议）──
  {
    id: 'job-interview-self-intro-n2',
    level: 'N2',
    note: '求职面试：寒暄→自我介绍→动机追问（5 轮）',
    turns: [
      { speaker: 'other', text: '本日はお忙しい中、お越しいただきありがとうございます。まずは簡単に自己紹介をお願いします。' },
      { speaker: 'user', text: 'はい、〇〇大学で情報工学を専攻しております、田中と申します。大学ではウェブアプリの開発を中心に学んできました。' },
      { speaker: 'other', text: '開発のご経験、具体的にはどのようなプロジェクトでしたか。' },
      { speaker: 'user', text: '研究室のメンバーと、予約管理のウェブアプリを作りました。フロントは React で、バックエンドは Node.js です。' },
      { speaker: 'other', text: 'ありがとうございます。では、数ある企業の中で、なぜ弊社を志望されたのでしょうか。' },
    ],
  },
  {
    id: 'job-interview-weakness-n1',
    level: 'N1',
    note: '求职面试：优缺点→追问事例→再追问改善（5 轮）',
    turns: [
      { speaker: 'other', text: 'ご自身の強みと弱みを、それぞれ教えてください。' },
      { speaker: 'user', text: '強みは粘り強く最後までやり遂げるところです。弱みは、慎重になりすぎて決断が遅くなることがある点です。' },
      { speaker: 'other', text: 'その弱みについて、実際に困ったエピソードを一つ伺えますか。' },
      { speaker: 'user', text: '以前のインターンで、仕様の確認に時間をかけすぎて、提出が一日遅れたことがあります。' },
      { speaker: 'other', text: 'その経験を踏まえて、今はどのように改善しようとしていますか。' },
    ],
  },
  {
    id: 'job-interview-salary-n2',
    level: 'N2',
    note: '求职面试：到岗→薪资→加班制度确认（5 轮）',
    turns: [
      { speaker: 'other', text: 'もしご縁があった場合、いつ頃から勤務可能でしょうか。' },
      { speaker: 'user', text: '来月の初めからであれば可能です。' },
      { speaker: 'other', text: '承知しました。希望年収についても、差し支えなければお聞かせください。' },
      { speaker: 'user', text: '経験を踏まえると、年収四百万円前後を希望しております。' },
      { speaker: 'other', text: '参考にいたします。なお、繁忙期は残業が発生することもありますが、ご理解いただけますか。' },
    ],
  },
  {
    id: 'uni-interview-research-n1',
    level: 'N1',
    note: '大学院面试：选题动机→方法质疑→两年目标（5 轮）',
    turns: [
      { speaker: 'other', text: '提出された研究計画書を拝見しました。なぜこのテーマを選ばれたのですか。' },
      { speaker: 'user', text: '学部の卒業研究で関連分野に触れ、社会実装の余地が大きいと感じたからです。' },
      { speaker: 'other', text: '計画書の手法ではデータ収集にかなり時間がかかると思われます。二年でどこまで到達できるとお考えですか。' },
      { speaker: 'user', text: '一年目で小規模なデータセットを作り、二年目でモデルの検証まで進めたいと考えています。' },
      { speaker: 'other', text: 'もしデータ収集が想定より遅れた場合、研究計画をどう調整しますか。' },
    ],
  },
  {
    id: 'clinic-symptoms-followup-n3',
    level: 'N3',
    note: '看病：主诉→体温咳鼻水→过敏史（5 轮）',
    turns: [
      { speaker: 'other', text: '今日はどうされましたか。' },
      { speaker: 'user', text: '三日前から喉が痛くて、熱も少しあります。' },
      { speaker: 'other', text: '最高体温は何度くらいでしたか。咳や鼻水はありますか。' },
      { speaker: 'user', text: '三十七度五分くらいです。咳は少しあります。鼻水はあまりないです。' },
      { speaker: 'other', text: '薬や食べ物のアレルギーはありますか。今、何かお薬を飲んでいますか。' },
    ],
  },
  {
    id: 'apartment-viewing-n3',
    level: 'N3',
    note: '看房：介绍→租金宠物→意向→入住时间（5 轮）',
    turns: [
      { speaker: 'other', text: 'こちらのお部屋は駅から徒歩七分で、敷金礼金はそれぞれ一ヶ月分です。' },
      { speaker: 'user', text: '家賃はいくらですか。ペットは飼えますか。' },
      { speaker: 'other', text: '家賃は八万五千円です。ペットは不可となっております。' },
      { speaker: 'user', text: 'ペットは飼わない予定です。初期費用の総額はだいたいどのくらいですか。' },
      { speaker: 'other', text: '目安として二十五万円前後です。ご検討いただけそうでしょうか。' },
    ],
  },
  {
    id: 'store-complaint-n3',
    level: 'N3',
    note: '投诉：故障说明→小票→换货/退款→保修确认（6 轮）',
    turns: [
      { speaker: 'user', text: 'すみません、昨日買ったこのイヤホン、音が右からしか出ないんです。' },
      { speaker: 'other', text: '大変申し訳ございません。レシートはお持ちでしょうか。' },
      { speaker: 'user', text: 'はい、こちらです。' },
      { speaker: 'other', text: '確認いたしました。新品との交換、または返金、どちらをご希望ですか。' },
      { speaker: 'user', text: 'できれば新品と交換したいです。' },
      { speaker: 'other', text: 'かしこまりました。交換後も保証は引き継がれますが、ご登録のお名前はレシートと同じでよろしいですか。' },
    ],
  },
  {
    id: 'business-meeting-pushback-n1',
    level: 'N1',
    note: '商务会议：提前工期→质量风险→加人预算→确认条件（5 轮）',
    turns: [
      { speaker: 'other', text: '今回の納期ですが、当初より二週間前倒しできないでしょうか。先方からの要望でして。' },
      { speaker: 'user', text: '前倒し自体は検討できますが、テスト工程を削ると品質リスクが上がります。' },
      { speaker: 'other', text: '品質は維持したまま、人員を増やして対応することは可能でしょうか。予算は多少上乗せできるかもしれません。' },
      { speaker: 'user', text: '人員追加とテスト期間の確保が前提なら、一週間程度の前倒しは可能だと思います。' },
      { speaker: 'other', text: 'それでは、追加予算の上限と、確定できる最短納期を来週までに共有いただけますか。' },
    ],
  },
  {
    id: 'bank-account-opening-n2',
    level: 'N2',
    note: '银行开户：材料确认→缺印鉴→假受理→下次预约（5 轮）',
    turns: [
      { speaker: 'other', text: '口座開設ですね。ご本人確認書類と、在留カード、ご印鑑はお持ちですか。' },
      { speaker: 'user', text: '在留カードとパスポートはありますが、印鑑は今日持ってきていません。' },
      { speaker: 'other', text: 'それでは本日は仮受付までとなり、印鑑をご持参のうえ再度お越しいただく形になりますが、よろしいですか。' },
      { speaker: 'user', text: 'わかりました。仮受付だけ先にお願いできますか。' },
      { speaker: 'other', text: 'はい。次回は平日の午前中が空いておりますが、ご都合のよい日時はありますか。' },
    ],
  },
  {
    id: 'parent-teacher-n2',
    level: 'N2',
    note: '家长会：优点→作业拖延→家庭对策→学校支援（5 轮）',
    turns: [
      { speaker: 'other', text: 'お子さんは授業中よく手を挙げて発言してくれます。ただ、宿題の提出が遅れることがときどきあります。' },
      { speaker: 'user', text: '家でも声をかけているのですが、ゲームの時間をうまく区切れなくて…。' },
      { speaker: 'other', text: 'ご家庭では、どのように学習時間を確保されていますか。' },
      { speaker: 'user', text: '夕食のあと一時間と決めていますが、最近は守れていない日もあります。' },
      { speaker: 'other', text: '学校側でサポートできることがあれば教えてください。例えば宿題の進捗メモを週一でお送りすることもできます。' },
    ],
  },
  {
    id: 'visa-renewal-n2',
    level: 'N2',
    note: '入管：材料确认→缺纳税证明→当日补件意向（5 轮）',
    turns: [
      { speaker: 'other', text: '在留期間更新の申請ですね。課税証明書と納税証明書は提出済みですか。' },
      { speaker: 'user', text: '課税証明書はあります。納税証明書はまだ取れていません。' },
      { speaker: 'other', text: 'では、そちらが揃い次第の受付になります。今日中に区役所で取得して戻られる予定はありますか。' },
      { speaker: 'user', text: 'これから区役所に行って、午後にもう一度来ようと思います。' },
      { speaker: 'other', text: '承知しました。受付は午後四時までですので、お早めにお戻りください。番号札は本日中有効です。' },
    ],
  },
  {
    id: 'conflict-mediation-n1',
    level: 'N1',
    note: '室友冲突：投诉→中立→逼站队→提出具体方案要求（5 轮）',
    turns: [
      { speaker: 'other', text: '昨日の件なんだけど、太郎さんがまた夜中まで大声で通話してて。私から言っても聞いてくれないから、あなたからも注意してくれない？' },
      { speaker: 'user', text: 'うーん、双方の話を一度ちゃんと聞いた方がいいと思う。' },
      { speaker: 'other', text: '聞くのはいいけど、結局あなたは私の味方なの？それとも中立のつもり？' },
      { speaker: 'user', text: '味方というより、三人でルールを決めた方がいいと思う。' },
      { speaker: 'other', text: 'じゃあ具体的に、何時以降は通話禁止とか、そういう案をあなたから出してくれる？' },
    ],
  },
  {
    id: 'job-interview-full-arc-n2',
    level: 'N2',
    note: '求职面试长弧：介绍→经验→动机→逆提问（7 轮）',
    turns: [
      { speaker: 'other', text: '本日はよろしくお願いいたします。まず自己紹介をお願いします。' },
      { speaker: 'user', text: '〇〇大学の佐藤です。専攻は経済学で、留学経験もあります。' },
      { speaker: 'other', text: '留学先では主に何を学ばれましたか。' },
      { speaker: 'user', text: 'マーケティングの授業を中心に取り、現地の企業で二ヶ月インターンもしました。' },
      { speaker: 'other', text: 'その経験は、弊社でどのように活かせるとお考えですか。' },
      { speaker: 'user', text: '海外顧客向けの企画や、調査データを分かりやすくまとめる仕事に活かせると思います。' },
      { speaker: 'other', text: '最後に、弊社についてご質問はございますか。' },
    ],
  },
]

/** Kanji-heavy / multi-turn cases — better signal for furigana + context ablations. */
export const RUBY_FOCUS_CASE_IDS = [
  'workplace-keigo-n2',
  'job-interview-self-intro-n2',
  'job-interview-weakness-n1',
  'job-interview-salary-n2',
  'job-interview-full-arc-n2',
  'uni-interview-research-n1',
  'clinic-symptoms-followup-n3',
  'apartment-viewing-n3',
  'store-complaint-n3',
  'business-meeting-pushback-n1',
  'bank-account-opening-n2',
  'parent-teacher-n2',
  'visa-renewal-n2',
  'conflict-mediation-n1',
] as const

export const RUBY_FOCUS_CASES: ReplyEvalCase[] = REPLY_EVAL_CASES.filter(c =>
  (RUBY_FOCUS_CASE_IDS as readonly string[]).includes(c.id),
)

export function caseToPromptArgs(fixture: ReplyEvalCase): {
  context: ConversationTurn[]
  level: string
} {
  return {
    context: toConversationTurns(fixture.turns),
    level: fixture.level,
  }
}
