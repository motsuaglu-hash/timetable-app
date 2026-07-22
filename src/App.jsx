// 中学校時間割作成Webアプリ v1.0
// 完全実装版 - React + TypeScript-like JSX

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ============================================================
// 初期データ
// ============================================================
const INITIAL_DAYS = [
  { id: "mon", label: "月", periods: 5 },
  { id: "tue", label: "火", periods: 6 },
  { id: "wed", label: "水", periods: 6 },
  { id: "thu", label: "木", periods: 6 },
  { id: "fri", label: "金", periods: 6 },
];

const INITIAL_CLASSES = [
  { id: "c1-1", name: "1-1", grade: 1, type: "normal", parentId: null },
  { id: "c1-2", name: "1-2", grade: 1, type: "normal", parentId: null },
  { id: "c1-3", name: "1-3", grade: 1, type: "normal", parentId: null },
  { id: "c2-1", name: "2-1", grade: 2, type: "normal", parentId: null },
  { id: "c2-2", name: "2-2", grade: 2, type: "normal", parentId: null },
  { id: "c3-1", name: "3-1", grade: 3, type: "normal", parentId: null },
  { id: "c3-2", name: "3-2", grade: 3, type: "normal", parentId: null },
];

const INITIAL_TEACHERS = [
  { id: "t1", name: "田中 太郎", homeroom: "c1-1", note: "" },
  { id: "t2", name: "佐藤 花子", homeroom: "c1-2", note: "" },
  { id: "t3", name: "鈴木 一郎", homeroom: "c2-1", note: "" },
  { id: "t4", name: "山田 美咲", homeroom: "c3-1", note: "" },
];

const SUBJECTS = ["国語","数学","英語","理科","社会","音楽","美術","音美","技術","家庭","技家","保体","道徳","学活","総合","自立","作業","生単","その他"];

const SUBJECT_COLORS = {
  "国語": "#ef4444", "数学": "#3b82f6", "英語": "#10b981", "理科": "#8b5cf6",
  "社会": "#f97316", "音楽": "#ec4899", "美術": "#06b6d4", "音美": "#d946ef",
  "技術": "#84cc16", "家庭": "#f59e0b", "技家": "#a3e635", "保体": "#14b8a6",
  "道徳": "#6366f1", "学活": "#78716c", "総合": "#64748b", "自立": "#a78bfa",
  "作業": "#fb923c", "生単": "#34d399", "その他": "#94a3b8"
};

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

// ============================================================
// 自動配置条件（placementRules）
// ------------------------------------------------------------
// 自動生成・エラーチェックの両方から参照する「配置ルール」を
// 1つのオブジェクトにまとめている。今後、非常勤講師・特別教室・
// 交流学級などの条件を追加する場合は、このオブジェクトに新しい
// キーを増やし、scoreCandidate() / checkErrors() にチェックを
// 追加するだけで拡張できる構造にしてある。
// ============================================================
const MAIN_SUBJECTS = ["国語", "数学", "英語", "理科", "社会"];
const GRADE_FIXABLE_SUBJECTS = ["学活", "道徳", "総合"];

// 学年を持たない学級（特別支援学級など）をグループ化する際の目印キー
const MIXED_GRADE_KEY = "mixed";

// 学級配列を並び替える際のソート用の値（学年なしは末尾へ）
function gradeSortValue(grade) {
  return grade == null ? Infinity : grade;
}

// 学年を設定しない学級種別（特支・交流はどちらも学年をまたぐ運用がありうるため）
function isGradelessClassType(type) {
  return type === "special" || type === "exchange";
}

// 指定した親学級・教科に対して自動で合流させるべき交流学級のIDを返す
// （交流学級側に parentId＝親学級、linkedSubjects＝合同で行う教科 を設定しておく）
function getLinkedExchangeClassIds(parentClassId, subject, classes) {
  if (!parentClassId || !subject) return [];
  return classes
    .filter(c => c.type === "exchange" && c.parentId === parentClassId && (c.linkedSubjects || []).includes(subject))
    .map(c => c.id);
}

// 授業の対象クラス・教科から、自動連携すべき交流学級を対象クラスへ追加する
// （追加が発生した場合は同時配置も自動でONにする）
function withAutoLinkedExchangeClasses(lesson, classes) {
  const baseIds = lesson.classIds || [];
  const autoLinked = new Set();
  for (const cid of baseIds) {
    for (const eid of getLinkedExchangeClassIds(cid, lesson.subject, classes)) {
      autoLinked.add(eid);
    }
  }
  const missing = [...autoLinked].filter(id => !baseIds.includes(id));
  if (missing.length === 0) return lesson;
  return { ...lesson, classIds: [...baseIds, ...missing], simultaneous: true };
}

const CONSECUTIVE_LIMIT_OPTIONS = [
  { value: "none", label: "制限なし" },
  { value: "max2", label: "最大2時間" },
  { value: "max3", label: "最大3時間" },
  { value: "max4", label: "最大4時間" },
  { value: "custom", label: "任意入力（2〜6）" },
];

function createDefaultPlacementRules() {
  return {
    teacherConsecutive: { mode: "max4", customValue: 4 },
    sameSubjectSameDay: false,
    gradeFixedSubjects: {
      "学活": { enabled: true, perGrade: {} },
      "道徳": { enabled: true, perGrade: {} },
      "総合": { enabled: true, perGrade: {} },
    },
    subjectForbiddenPeriods: {}, // { [subject]: number[] }
    simultaneousForbiddenSubjects: [], // string[]
    balanceMainSubjects: true,
  };
}

// 保存データに古い/欠けているフィールドがあってもデフォルトで補完する
function mergePlacementRules(saved) {
  const base = createDefaultPlacementRules();
  if (!saved || typeof saved !== "object") return base;
  const merged = {
    ...base,
    ...saved,
    teacherConsecutive: { ...base.teacherConsecutive, ...(saved.teacherConsecutive || {}) },
    gradeFixedSubjects: { ...base.gradeFixedSubjects },
    subjectForbiddenPeriods: { ...(saved.subjectForbiddenPeriods || {}) },
    simultaneousForbiddenSubjects: saved.simultaneousForbiddenSubjects || [],
  };
  for (const subject of GRADE_FIXABLE_SUBJECTS) {
    merged.gradeFixedSubjects[subject] = {
      enabled: base.gradeFixedSubjects[subject].enabled,
      perGrade: {},
      ...(saved.gradeFixedSubjects?.[subject] || {}),
    };
  }
  return merged;
}

function getConsecutiveLimitValue(rules) {
  const mode = rules?.teacherConsecutive?.mode || "max4";
  if (mode === "none") return Infinity;
  if (mode === "max2") return 2;
  if (mode === "max3") return 3;
  if (mode === "max4") return 4;
  if (mode === "custom") {
    const v = Number(rules?.teacherConsecutive?.customValue);
    if (!v || Number.isNaN(v)) return 4;
    return Math.min(6, Math.max(2, v));
  }
  return 4;
}

// ある授業が実際に何コマ分配置されているかを「(曜日,時限)の異なり数」で数える。
// 合同授業（同時配置）は複数クラスの同じコマに同時に置かれるため、
// 単純にセル内の出現回数を数えると週時数を過剰に消費してしまうのを防ぐ。
function countLessonSlotInstances(lessonId, placements) {
  const slots = new Set();
  for (const [k, ids] of Object.entries(placements)) {
    if (!(ids || []).includes(lessonId)) continue;
    const parts = k.split("__");
    slots.add(`${parts[1]}__${parts[2]}`);
  }
  return slots.size;
}

// 特定教員が指定コマにすでに配置されているか（クラス問わず全体で判定）
function isTeacherBusyAtSlot(teacherId, dayId, period, placements, lessons) {
  for (const [k, ids] of Object.entries(placements)) {
    const parts = k.split("__");
    if (parts[1] !== dayId || Number(parts[2]) !== period) continue;
    for (const lid of (ids || [])) {
      const l = lessons.find(x => x.id === lid);
      if (l && [l.teacherId, ...(l.subTeacherIds || [])].filter(Boolean).includes(teacherId)) {
        return true;
      }
    }
  }
  return false;
}

// 指定コマに配置した場合の連続コマ数（前後の既存配置＋このコマ自身）を数える
function consecutiveRunLength(teacherId, dayId, period, placements, lessons) {
  let run = 1;
  let p = period - 1;
  while (p >= 1 && isTeacherBusyAtSlot(teacherId, dayId, p, placements, lessons)) { run++; p--; }
  p = period + 1;
  while (isTeacherBusyAtSlot(teacherId, dayId, p, placements, lessons)) { run++; p++; }
  return run;
}

// 教科ごとの配置禁止時限に該当するか
function isForbiddenPeriod(subject, period, rules) {
  const list = rules?.subjectForbiddenPeriods?.[subject];
  return Array.isArray(list) && list.includes(period);
}

// 同じ学年・同じコマに「同時配置禁止教科」が複数配置されているクラス数を数える
// （このセル自身は候補判定側で計算前に除くので、それ以外の既存配置のみ対象）
function countSimultaneousForbiddenInGrade(grade, dayId, period, excludeClassId, placements, lessons, classes, rules) {
  const targetSubjects = rules?.simultaneousForbiddenSubjects || [];
  if (targetSubjects.length === 0) return 0;
  const gradeClassIds = new Set(classes.filter(c => c.grade === grade).map(c => c.id));
  let count = 0;
  for (const [k, ids] of Object.entries(placements)) {
    const parts = k.split("__");
    const classId = parts[0];
    if (classId === excludeClassId) continue;
    if (!gradeClassIds.has(classId)) continue;
    if (parts[1] !== dayId || Number(parts[2]) !== period) continue;
    for (const lid of (ids || [])) {
      const l = lessons.find(x => x.id === lid);
      if (l && targetSubjects.includes(l.subject)) { count++; break; }
    }
  }
  return count;
}

// 指定コマへの配置が「配置不可能」と判定される理由の一覧を返す（空配列なら配置可能）。
// 自動生成の候補除外と、手動ドラッグ＆ドロップ時の拒否理由表示の両方から共通で使う。
// isFixedCell: そのコマに既に固定済みの授業が置かれているか（呼び出し側で判定して渡す）
function getBlockReasons({ lesson, classId, dayId, period, placements, lessons, rules, isFixedCell }) {
  const reasons = [];
  if (isFixedCell) reasons.push("固定コマ");

  const teacherIds = [lesson.teacherId, ...(lesson.subTeacherIds || [])].filter(Boolean);
  const consecutiveLimit = getConsecutiveLimitValue(rules);
  if (Number.isFinite(consecutiveLimit) && teacherIds.length > 0) {
    const maxRun = Math.max(...teacherIds.map(tid => consecutiveRunLength(tid, dayId, period, placements, lessons)));
    if (maxRun > consecutiveLimit) reasons.push("教員連続授業上限");
  }

  if (isForbiddenPeriod(lesson.subject, period, rules)) reasons.push("禁止時間");

  if (rules?.sameSubjectSameDay) {
    const sameDaySub = Object.entries(placements).some(([k, ids]) => {
      const [c, d] = k.split("__");
      return c === classId && d === dayId &&
        (ids || []).some(lid => lessons.find(l => l.id === lid)?.subject === lesson.subject);
    });
    if (sameDaySub) reasons.push("同日同教科");
  }

  return reasons;
}

// ============================================================
// エラーチェック
// ============================================================
function checkErrors(placements, lessons, teachers, meetings, days, classes = [], rules = null) {
  const errors = [];
  const consecutiveLimit = getConsecutiveLimitValue(rules);

  // 全コマを走査
  for (const [key, placedIds] of Object.entries(placements)) {
    const [classId, dayId, period] = key.split("__");
    if (!placedIds || placedIds.length === 0) continue;

    for (const lessonId of placedIds) {
      const lesson = lessons.find(l => l.id === lessonId);
      if (!lesson) continue;

      // 教員重複チェック
      const teacherIds = [lesson.teacherId, ...(lesson.subTeacherIds || [])].filter(Boolean);
      for (const tid of teacherIds) {
        // 他の授業で同じ教員が同コマにいるか（同一セル内の重複も対象）
        for (const [k2, ids2] of Object.entries(placements)) {
          const [, d2, p2] = k2.split("__");
          if (d2 !== dayId || p2 !== period) continue;
          for (const lid2 of (ids2 || [])) {
            if (lid2 === lessonId) continue;
            const l2 = lessons.find(l => l.id === lid2);
            if (!l2) continue;
            const tids2 = [l2.teacherId, ...(l2.subTeacherIds || [])].filter(Boolean);
            if (tids2.includes(tid)) {
              const t = teachers.find(t => t.id === tid);
              errors.push({
                id: generateId(),
                type: "teacher_conflict",
                severity: "error",
                message: `教員重複: ${t?.name || tid}`,
                cellKey: key,
                lessonId,
              });
            }
          }
        }

        // 会議コマチェック
        const meeting = meetings.find(m =>
          m.teacherIds.includes(tid) && m.dayId === dayId && String(m.period) === String(period)
        );
        if (meeting) {
          const t = teachers.find(t => t.id === tid);
          errors.push({
            id: generateId(),
            type: "meeting_conflict",
            severity: "error",
            message: `会議コマ配置: ${t?.name || tid} (${meeting.name})`,
            cellKey: key,
            lessonId,
          });
        }
      }

      // 同日同教科チェック
      const sameDay = Object.entries(placements).filter(([k2]) => {
        const [c2, d2] = k2.split("__");
        return c2 === classId && d2 === dayId && k2 !== key;
      });
      for (const [, ids2] of sameDay) {
        for (const lid2 of (ids2 || [])) {
          const l2 = lessons.find(l => l.id === lid2);
          if (l2 && l2.subject === lesson.subject && l2.id !== lesson.id) {
            errors.push({
              id: generateId(),
              type: "same_day_subject",
              severity: "warning",
              message: `同日同教科: ${lesson.subject}`,
              cellKey: key,
              lessonId,
            });
          }
        }
      }

      // 教科ごとの配置禁止時間チェック
      if (isForbiddenPeriod(lesson.subject, Number(period), rules)) {
        errors.push({
          id: generateId(),
          type: "forbidden_slot",
          severity: "error",
          message: `配置禁止時間: ${lesson.subject}（${period}限）`,
          cellKey: key,
          lessonId,
        });
      }

      // 教員の連続授業上限チェック
      if (Number.isFinite(consecutiveLimit)) {
        for (const tid of teacherIds) {
          const run = consecutiveRunLength(tid, dayId, Number(period), placements, lessons);
          if (run > consecutiveLimit) {
            const t = teachers.find(t => t.id === tid);
            errors.push({
              id: generateId(),
              type: "consecutive_exceeded",
              severity: "error",
              message: `連続授業超過: ${t?.name || tid}（${run}連続）`,
              cellKey: key,
              lessonId,
            });
          }
        }
      }

      // 同じ時間帯に配置しない教科チェック（学年単位）
      if ((rules?.simultaneousForbiddenSubjects || []).includes(lesson.subject)) {
        const grade = classes.find(c => c.id === classId)?.grade;
        if (grade != null) {
          const conflictCount = countSimultaneousForbiddenInGrade(
            grade, dayId, Number(period), classId, placements, lessons, classes, rules
          );
          if (conflictCount > 0) {
            errors.push({
              id: generateId(),
              type: "simultaneous_subject_conflict",
              severity: "warning",
              message: `同時間教科重複: ${lesson.subject}（${grade}年内で重複）`,
              cellKey: key,
              lessonId,
            });
          }
        }
      }
    }
  }

  // 重複排除
  const seen = new Set();
  return errors.filter(e => {
    const k = `${e.type}__${e.cellKey}__${e.lessonId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ============================================================
// 自動生成アルゴリズム
// ------------------------------------------------------------
// 各候補コマは scoreCandidate() で一括評価する。今後、条件を
// 追加する場合は scoreCandidate() 内に1ブロック足すだけでよい。
// ============================================================

// 候補コマ1つ分のスコアを計算する。
// blocked: true の場合はそもそも配置候補から除外する（固定コマ相当の絶対NG）。
// それ以外は減点方式のソフトスコアとして扱う。
// classIds: 対象クラスの配列（通常授業は1件、合同授業は複数件を同時に評価する）
function scoreCandidate({ lesson, classIds, dayId, period, placements, lessons, meetings, classes, rules }) {
  const teacherIds = [lesson.teacherId, ...(lesson.subTeacherIds || [])].filter(Boolean);

  // 教員連続授業上限・配置禁止時間・同日同教科（ON時）は絶対NGとして候補から除外する
  // （合同授業は対象クラスのいずれか1つでも該当すればブロックする）
  let blockReasons = [];
  for (const classId of classIds) {
    blockReasons = blockReasons.concat(
      getBlockReasons({ lesson, classId, dayId, period, placements, lessons, rules, isFixedCell: false })
    );
  }
  blockReasons = [...new Set(blockReasons)];
  if (blockReasons.length > 0) {
    return { blocked: true, score: -Infinity, reasons: blockReasons };
  }

  let score = 10;

  // 会議コマ・教員重複は同じ教員・同じ時間の話なので1回だけ評価すればよい
  const hasMeeting = meetings.some(m =>
    m.dayId === dayId && m.period === period && teacherIds.some(t => m.teacherIds.includes(t))
  );
  if (hasMeeting) score -= 1000;

  const teacherBusy = teacherIds.some(tid => isTeacherBusyAtSlot(tid, dayId, period, placements, lessons));
  if (teacherBusy) score -= 1000;

  // 以下はクラスごとに評価し、該当したクラスの分だけ加算する
  for (const classId of classIds) {
    const grade = classes.find(c => c.id === classId)?.grade;

    // 同日同教科（OFF時のソフト減点。ON時は上のgetBlockReasonsで既に除外済み）
    const sameDaySub = Object.entries(placements).some(([k, ids]) => {
      const [c, d] = k.split("__");
      return c === classId && d === dayId &&
        (ids || []).some(lid => lessons.find(l => l.id === lid)?.subject === lesson.subject);
    });
    if (sameDaySub) score -= 300;

    // 同じ時間帯に配置しない教科（学年単位）
    if ((rules?.simultaneousForbiddenSubjects || []).includes(lesson.subject) && grade != null) {
      const conflictCount = countSimultaneousForbiddenInGrade(grade, dayId, period, classId, placements, lessons, classes, rules);
      if (conflictCount > 0) score -= 250;
    }

    // 主要5教科の分散配置
    if (rules?.balanceMainSubjects && MAIN_SUBJECTS.includes(lesson.subject)) {
      const alreadyThisDay = Object.entries(placements).some(([k, ids]) => {
        const [c, d] = k.split("__");
        return c === classId && d === dayId &&
          (ids || []).some(lid => MAIN_SUBJECTS.includes(lessons.find(l => l.id === lid)?.subject));
      });
      if (alreadyThisDay) score -= 100;
    }
  }

  // ランダム性（同点候補のばらけ用）
  score += Math.random() * 5;

  return { blocked: false, score };
}

function autoGenerate(lessons, placements, days, meetings, teachers, classes = [], rules = null) {
  const effectiveRules = rules || createDefaultPlacementRules();
  const newPlacements = { ...placements };

  // ④ 学年単位で固定する教科（学活・道徳・総合）を先に強制配置する
  for (const subject of GRADE_FIXABLE_SUBJECTS) {
    const conf = effectiveRules.gradeFixedSubjects?.[subject];
    if (!conf?.enabled) continue;
    for (const [gradeStr, slot] of Object.entries(conf.perGrade || {})) {
      if (!slot) continue;
      const grade = Number(gradeStr);
      for (const cls of classes.filter(c => c.grade === grade)) {
        const key = `${cls.id}__${slot.dayId}__${slot.period}`;
        if (newPlacements[key]?.length > 0) continue; // 既に何か入っていれば上書きしない
        const lesson = lessons.find(l => l.subject === subject && (l.classIds || []).includes(cls.id));
        if (!lesson) continue;
        const placedCount = countLessonSlotInstances(lesson.id, newPlacements);
        if (placedCount >= (lesson.weeklyHours || 1)) continue;
        newPlacements[key] = [...(newPlacements[key] || []), lesson.id];
      }
    }
  }

  // 配置対象授業（既存の配置コマ数はここでは固定/非固定を問わず既に埋まっているコマとして扱う。
  // 自動生成は空きコマにしか配置しないため、固定コマは自然にそのまま残る）
  // 合同授業（simultaneous かつ対象クラスが複数）は、1インスタンス＝全対象クラスへの同時配置として扱う。
  const targets = [];
  for (const lesson of lessons) {
    const classIds = (lesson.classIds || []).filter(Boolean);
    if (classIds.length === 0) continue;
    const placed = countLessonSlotInstances(lesson.id, newPlacements);
    const remaining = (lesson.weeklyHours || 1) - placed;
    const targetClassIds = lesson.simultaneous && classIds.length > 1 ? classIds : [classIds[0]];
    for (let i = 0; i < remaining; i++) {
      targets.push({ lesson, classIds: targetClassIds });
    }
  }

  // スコア方式で最良コマへ配置（配置できなかった場合は理由を集計する）
  const unplacedReasons = {};
  for (const { lesson, classIds } of targets) {
    const slots = [];
    const rejectedReasons = new Set();
    let anyEmptyCell = false;
    for (const day of days) {
      for (let p = 1; p <= day.periods; p++) {
        const cellKeys = classIds.map(cid => `${cid}__${day.id}__${p}`);
        if (cellKeys.some(k => newPlacements[k]?.length > 0)) continue; // 対象クラス全てが空きの場合のみ候補にする
        anyEmptyCell = true;

        const result = scoreCandidate({
          lesson, classIds, dayId: day.id, period: p,
          placements: newPlacements, lessons, meetings, classes, rules: effectiveRules,
        });
        if (result.blocked) {
          (result.reasons || []).forEach(r => rejectedReasons.add(r));
          continue;
        }
        slots.push({ dayId: day.id, period: p, score: result.score });
      }
    }

    slots.sort((a, b) => b.score - a.score);
    if (slots.length > 0) {
      const best = slots[0];
      for (const cid of classIds) {
        const key = `${cid}__${best.dayId}__${best.period}`;
        newPlacements[key] = [...(newPlacements[key] || []), lesson.id];
      }
    } else {
      if (!anyEmptyCell) rejectedReasons.add("空きコマなし");
      if (!unplacedReasons[lesson.id]) unplacedReasons[lesson.id] = new Set();
      for (const r of rejectedReasons) unplacedReasons[lesson.id].add(r);
    }
  }

  const unplacedReasonsOut = {};
  for (const [lid, set] of Object.entries(unplacedReasons)) {
    unplacedReasonsOut[lid] = [...set];
  }

  return { placements: newPlacements, unplacedReasons: unplacedReasonsOut };
}

// ============================================================
// メインコンポーネント
// ============================================================
export default function TimetableApp() {
  const [days, setDays] = useState(INITIAL_DAYS);
  const [classes, setClasses] = useState(INITIAL_CLASSES);
  const [teachers, setTeachers] = useState(INITIAL_TEACHERS);
  const [lessons, setLessons] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [placements, setPlacements] = useState({});
  const [fixedPlacements, setFixedPlacements] = useState(() => new Set());
  const [placementRules, setPlacementRules] = useState(() => createDefaultPlacementRules());
  const [errors, setErrors] = useState([]);
  const [view, setView] = useState("class"); // "class" | "teacher"
  const [rightPanel, setRightPanel] = useState(null); // null | "teachers" | "classes" | "lesson" | "meetings" | "days" | "manual"
  const [bottomTab, setBottomTab] = useState("errors");
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [collapsedGrades, setCollapsedGrades] = useState({});
  const [paletteFilter, setPaletteFilter] = useState("all");
  const [paletteSearch, setPaletteSearch] = useState("");
  const [editLesson, setEditLesson] = useState(null);
  const [newTeacher, setNewTeacher] = useState({ name: "", homeroom: "", note: "" });
  const [newClass, setNewClass] = useState({ name: "", grade: 1, type: "normal", parentId: null, linkedSubjects: [] });
  const [newMeeting, setNewMeeting] = useState({ name: "", teacherIds: [], dayId: "mon", period: 1 });
  const [toast, setToast] = useState(null);
  const [unplacedReasons, setUnplacedReasons] = useState({}); // 直近の自動生成で配置できなかった理由

  // エラー再計算
  useEffect(() => {
    setErrors(checkErrors(placements, lessons, teachers, meetings, days, classes, placementRules));
  }, [placements, lessons, teachers, meetings, days, classes, placementRules]);

  // 履歴保存
  const saveHistory = useCallback((newPlacements) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newPlacements);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setPlacements(newPlacements);
  }, [history, historyIndex]);

  const undo = () => {
    if (historyIndex <= 0) return;
    const idx = historyIndex - 1;
    setHistoryIndex(idx);
    setPlacements(history[idx] || {});
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const idx = historyIndex + 1;
    setHistoryIndex(idx);
    setPlacements(history[idx]);
  };

  // 授業の配置済み数を計算
  const getPlacedCount = useCallback((lessonId) => {
    return countLessonSlotInstances(lessonId, placements);
  }, [placements]);

  // 特定のコマ内の配置が固定されているか（固定はコマ単位）
  const isFixed = useCallback((cellKey, lessonId) => {
    return fixedPlacements.has(`${cellKey}::${lessonId}`);
  }, [fixedPlacements]);

  // その授業がどこか一箇所でも固定されているか（パレット表示用）
  const isLessonFixedAnywhere = useCallback((lessonId) => {
    for (const k of fixedPlacements) {
      if (k.endsWith(`::${lessonId}`)) return true;
    }
    return false;
  }, [fixedPlacements]);

  // パレット表示の授業一覧
  const paletteItems = useMemo(() => {
    return lessons.filter(l => {
      const placed = getPlacedCount(l.id);
      const remaining = (l.weeklyHours || 1) - placed;
      const hasError = errors.some(e => e.lessonId === l.id);

      if (paletteFilter === "unplaced" && remaining <= 0) return false;
      if (paletteFilter === "fixed" && !isLessonFixedAnywhere(l.id)) return false;
      if (paletteFilter === "errors" && !hasError) return false;
      if (paletteSearch) {
        const q = paletteSearch.toLowerCase();
        const t = teachers.find(t => t.id === l.teacherId);
        return l.subject?.toLowerCase().includes(q) ||
          l.classIds?.some(cid => classes.find(c => c.id === cid)?.name.toLowerCase().includes(q)) ||
          t?.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [lessons, placements, errors, paletteFilter, paletteSearch, teachers, classes, getPlacedCount, isLessonFixedAnywhere]);

  // グリッドセルの列ヘッダー
  const columns = useMemo(() => {
    const cols = [];
    for (const day of days) {
      for (let p = 1; p <= day.periods; p++) {
        cols.push({ dayId: day.id, dayLabel: day.label, period: p });
      }
    }
    return cols;
  }, [days]);

  // 学年グループ（学年を持たない特別支援学級は MIXED_GRADE_KEY にまとめる）
  const gradeGroups = useMemo(() => {
    const groups = {};
    for (const cls of classes) {
      const g = cls.grade == null ? MIXED_GRADE_KEY : cls.grade;
      if (!groups[g]) groups[g] = [];
      groups[g].push(cls);
    }
    return groups;
  }, [classes]);

  // ドラッグ開始
  const handleDragStart = (e, lessonId, fromKey) => {
    setDragging({ lessonId, fromKey });
    e.dataTransfer.effectAllowed = "move";
  };

  // ドロップ
  const handleDrop = (e, classId, dayId, period) => {
    e.preventDefault();
    if (!dragging) return;
    const { lessonId, fromKey } = dragging;
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) {
      setDragging(null);
      setDragOver(null);
      return;
    }

    // 合同授業（同時配置）は対象クラス全てへ同時に配置・移動する
    const isJoint = lesson.simultaneous && (lesson.classIds || []).length > 1;
    const targetClassIds = isJoint ? lesson.classIds : [classId];

    const newP = { ...placements };

    if (isJoint && fromKey) {
      // 移動元と同じ（曜日・時限）のコマだけを対象クラス分だけ削除する
      // （週複数コマの場合、他の曜日・時限のインスタンスに影響しないようにする）
      const [, fromDayId, fromPeriod] = fromKey.split("__");
      for (const cid of lesson.classIds) {
        const key = `${cid}__${fromDayId}__${fromPeriod}`;
        if ((newP[key] || []).includes(lessonId)) {
          newP[key] = newP[key].filter(id => id !== lessonId);
        }
      }
    } else if (fromKey) {
      newP[fromKey] = (newP[fromKey] || []).filter(id => id !== lessonId);
    }

    // 配置不可判定（固定コマ・教員連続授業上限・禁止時間・同日同教科ON時）
    // 合同授業の場合は対象クラス全てで判定し、いずれかがNGなら配置しない
    let reasons = [];
    for (const cid of targetClassIds) {
      const key = `${cid}__${dayId}__${period}`;
      const existingIds = newP[key] || [];
      const hasFixed = existingIds.some(id => isFixed(key, id));
      if (isJoint && cid !== classId && existingIds.length > 0) {
        reasons.push("交流先のコマが埋まっている");
        continue;
      }
      reasons = reasons.concat(getBlockReasons({
        lesson, classId: cid, dayId, period,
        placements: newP, lessons, rules: placementRules, isFixedCell: hasFixed,
      }));
    }
    reasons = [...new Set(reasons)];

    if (reasons.length > 0) {
      const className = classes.find(c => c.id === classId)?.name || classId;
      showToast(
        ["配置できなかった理由", `■ ${lesson.subject}（${className}）`, ...reasons.map(r => `・${r}`)].join("\n"),
        "error",
        4500
      );
      setDragging(null);
      setDragOver(null);
      return;
    }

    // 配置（合同授業は対象クラス全てへ同じコマに配置）
    for (const cid of targetClassIds) {
      const key = `${cid}__${dayId}__${period}`;
      newP[key] = [...(newP[key] || []), lessonId];
    }
    saveHistory(newP);
    setDragging(null);
    setDragOver(null);
  };

  const handleDragOver = (e, key) => {
    e.preventDefault();
    setDragOver(key);
  };

  // トースト表示
  const showToast = (msg, type = "info", duration = 3000) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), duration);
  };

  // 自動生成
  const handleAutoGenerate = () => {
    const result = autoGenerate(lessons, placements, days, meetings, teachers, classes, placementRules);
    saveHistory(result.placements);
    setUnplacedReasons(result.unplacedReasons);
    const unplacedCount = Object.keys(result.unplacedReasons).length;
    if (unplacedCount > 0) {
      showToast(`自動生成完了。${unplacedCount}件の授業を配置できませんでした（未配置タブを確認）`, "error");
    } else {
      showToast("自動生成完了！内容を確認して調整してください", "success");
    }
  };

  // セルをクリックで授業削除など
  const handleCellLessonClick = (e, lessonId, cellKey) => {
    e.stopPropagation();
    const lesson = lessons.find(l => l.id === lessonId);
    setSelectedLesson({ lessonId, cellKey, lesson });
  };

  // 固定トグル（該当コマの配置のみを固定/解除する。合同授業は対象クラス全てをまとめて固定/解除）
  const toggleFixed = (lessonId, cellKey) => {
    const lesson = lessons.find(l => l.id === lessonId);
    const isJoint = lesson?.simultaneous && (lesson.classIds || []).length > 1;
    const [, dayId, period] = cellKey.split("__");

    setFixedPlacements(prev => {
      const next = new Set(prev);
      if (isJoint) {
        const keys = lesson.classIds.map(cid => `${cid}__${dayId}__${period}::${lessonId}`);
        const anyFixed = keys.some(k => next.has(k));
        for (const k of keys) {
          if (anyFixed) next.delete(k); else next.add(k);
        }
      } else {
        const key = `${cellKey}::${lessonId}`;
        if (next.has(key)) next.delete(key); else next.add(key);
      }
      return next;
    });
    setSelectedLesson(null);
  };

  // 授業をセルから削除（合同授業は対象クラス全てのコマから同時に削除する）
  const removePlacement = (lessonId, cellKey) => {
    const lesson = lessons.find(l => l.id === lessonId);
    const isJoint = lesson?.simultaneous && (lesson.classIds || []).length > 1;
    const newP = { ...placements };
    if (isJoint) {
      // 削除対象と同じ（曜日・時限）のコマだけを対象クラス分だけ削除する
      const [, dayId, period] = cellKey.split("__");
      for (const cid of lesson.classIds) {
        const key = `${cid}__${dayId}__${period}`;
        if ((newP[key] || []).includes(lessonId)) {
          newP[key] = newP[key].filter(id => id !== lessonId);
        }
      }
    } else {
      newP[cellKey] = (newP[cellKey] || []).filter(id => id !== lessonId);
    }
    saveHistory(newP);
    setSelectedLesson(null);
  };

  // 保存
  const handleSave = () => {
    const data = { days, classes, teachers, lessons, meetings, placements, fixedPlacements: [...fixedPlacements], placementRules };
    localStorage.setItem("timetable_data", JSON.stringify(data));
    showToast("ブラウザに保存しました", "success");
  };

  // JSONファイル保存
  const handleExportJSON = () => {
    const data = { days, classes, teachers, lessons, meetings, placements, fixedPlacements: [...fixedPlacements], placementRules };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `timetable_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  // JSONファイル読み込み
  const handleImportJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.days) setDays(data.days);
        if (data.classes) setClasses(data.classes);
        if (data.teachers) setTeachers(data.teachers);
        if (data.lessons) setLessons(data.lessons);
        if (data.meetings) setMeetings(data.meetings);
        if (data.placements) {
          setPlacements(data.placements);
          setHistory([data.placements]);
          setHistoryIndex(0);
        }
        setFixedPlacements(new Set(data.fixedPlacements || []));
        setPlacementRules(mergePlacementRules(data.placementRules));
        showToast("データを読み込みました", "success");
      } catch {
        showToast("ファイルの読み込みに失敗しました", "error");
      }
    };
    reader.readAsText(file);
  };

  // ブラウザ保存から読み込み
  useEffect(() => {
    const saved = localStorage.getItem("timetable_data");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.days) setDays(data.days);
        if (data.classes) setClasses(data.classes);
        if (data.teachers) setTeachers(data.teachers);
        if (data.lessons) setLessons(data.lessons);
        if (data.meetings) setMeetings(data.meetings);
        if (data.placements) {
          setPlacements(data.placements);
          setHistory([data.placements]);
          setHistoryIndex(0);
        }
        if (data.fixedPlacements) setFixedPlacements(new Set(data.fixedPlacements));
        if (data.placementRules) setPlacementRules(mergePlacementRules(data.placementRules));
      } catch {}
    }
  }, []);

  // Excel風CSV出力
  const handleExportCSV = () => {
    if (errors.length > 0) {
      if (!window.confirm(`エラーが${errors.length}件残っています。このまま出力しますか？`)) return;
    }
    let csv = "学級,";
    for (const col of columns) {
      csv += `${col.dayLabel}${col.period},`;
    }
    csv += "\n";

    for (const cls of classes) {
      csv += `${cls.name},`;
      for (const col of columns) {
        const key = `${cls.id}__${col.dayId}__${col.period}`;
        const ids = placements[key] || [];
        const names = ids.map(id => {
          const l = lessons.find(l => l.id === id);
          return l ? l.subject : "";
        });
        csv += `"${names.join("/")}",`;
      }
      csv += "\n";
    }

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `timetable_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    showToast("CSV（Excel用）を出力しました", "success");
  };

  // 授業作成
  const createLesson = () => {
    const newLesson = {
      id: generateId(),
      subject: "国語",
      classIds: classes.length > 0 ? [classes[0].id] : [],
      teacherId: teachers.length > 0 ? teachers[0].id : null,
      subTeacherIds: [],
      weeklyHours: 3,
      simultaneous: false,
    };
    setEditLesson(newLesson);
    setRightPanel("lesson");
  };

  const saveLesson = () => {
    if (!editLesson) return;
    const toSave = withAutoLinkedExchangeClasses(editLesson, classes);
    if (lessons.find(l => l.id === toSave.id)) {
      setLessons(prev => prev.map(l => l.id === toSave.id ? toSave : l));
    } else {
      setLessons(prev => [...prev, toSave]);
    }
    setEditLesson(null);
    showToast("授業を保存しました", "success");
  };

  const deleteLesson = (id) => {
    setLessons(prev => prev.filter(l => l.id !== id));
    const newP = { ...placements };
    for (const key of Object.keys(newP)) {
      newP[key] = (newP[key] || []).filter(lid => lid !== id);
    }
    setPlacements(newP);
    setEditLesson(null);
    showToast("授業を削除しました", "info");
  };

  // 学年単位で固定する教科（学活・道徳・総合）向け：まだ授業がない学級に
  // その学級の担任を担当教員として自動で授業を作成する
  const bulkCreateHomeroomLessons = (subject, grade) => {
    const gradeClasses = classes.filter(c => c.grade === grade);
    const newLessons = [];
    let skipped = 0;
    let missingHomeroom = 0;
    for (const cls of gradeClasses) {
      const exists = lessons.some(l => l.subject === subject && (l.classIds || []).includes(cls.id));
      if (exists) { skipped++; continue; }
      const homeroomTeacher = teachers.find(t => t.homeroom === cls.id);
      if (!homeroomTeacher) missingHomeroom++;
      newLessons.push({
        id: generateId(),
        subject,
        classIds: [cls.id],
        teacherId: homeroomTeacher ? homeroomTeacher.id : null,
        subTeacherIds: [],
        weeklyHours: 1,
        simultaneous: false,
      });
    }
    if (newLessons.length > 0) {
      setLessons(prev => [...prev, ...newLessons]);
    }
    const parts = [`${newLessons.length}件作成`];
    if (skipped > 0) parts.push(`${skipped}件は既存のためスキップ`);
    if (missingHomeroom > 0) parts.push(`${missingHomeroom}件は学級担任未設定のため担当教員は未定のまま`);
    showToast(`${subject}（${grade}年）: ${parts.join("、")}`, newLessons.length > 0 ? "success" : "info");
  };

  // 教員ビューのグリッド
  const teacherGrid = useMemo(() => {
    if (view !== "teacher") return null;
    return teachers.map(teacher => {
      const row = {};
      for (const col of columns) {
        const key = `t${teacher.id}__${col.dayId}__${col.period}`;
        // この教員が担当している授業を検索
        const found = [];
        for (const [k, ids] of Object.entries(placements)) {
          const [, dayId, period] = k.split("__");
          if (dayId !== col.dayId || String(period) !== String(col.period)) continue;
          for (const lessonId of (ids || [])) {
            const l = lessons.find(l => l.id === lessonId);
            if (l && ([l.teacherId, ...(l.subTeacherIds||[])].includes(teacher.id))) {
              const cls = classes.find(c => l.classIds?.includes(c.id));
              found.push({ lesson: l, className: cls?.name || "?" });
            }
          }
        }
        row[key] = found;
      }
      return { teacher, row };
    });
  }, [view, teachers, columns, placements, lessons, classes]);

  const errorCount = errors.filter(e => e.severity === "error").length;
  const warnCount = errors.filter(e => e.severity === "warning").length;

  // ============================================================
  // レンダリング
  // ============================================================
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      fontFamily: "'Noto Sans JP', sans-serif",
      background: "#0f172a", color: "#e2e8f0",
      fontSize: "13px",
    }}>

      {/* ヘッダー */}
      <header style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: "6px 12px", background: "#1e293b",
        borderBottom: "1px solid #334155", flexShrink: 0,
        flexWrap: "wrap",
      }}>
        <span style={{ fontWeight: 700, color: "#38bdf8", marginRight: 8, fontSize: 15 }}>
          📅 時間割くん
        </span>

        <BtnH onClick={handleSave} color="#22c55e">💾 一時保存</BtnH>

        <label style={{ cursor: "pointer" }}>
        <input type="file" accept=".json" style={{ display: "none" }} onChange={handleImportJSON} />
        <span style={btnHStyle("#38bdf8")}>📂 ファイルを開く</span>
        </label>

        <BtnH onClick={handleExportJSON} color="#a78bfa">💾 ファイルに保存</BtnH>

        <div style={{ width: 1, background: "#334155", height: 24, margin: "0 4px" }} />

        <BtnH onClick={handleAutoGenerate} color="#f59e0b">⚡ 自動生成</BtnH>
        <BtnH onClick={() => {
          const result = autoGenerate(lessons, placements, days, meetings, teachers, classes, placementRules);
          saveHistory(result.placements);
          setUnplacedReasons(result.unplacedReasons);
          const unplacedCount = Object.keys(result.unplacedReasons).length;
          showToast(
            unplacedCount > 0 ? `再配置しました。${unplacedCount}件の授業を配置できませんでした` : "再配置しました",
            unplacedCount > 0 ? "error" : "success"
          );
        }} color="#fb923c">🔄 再配置</BtnH>

        <div style={{ width: 1, background: "#334155", height: 24, margin: "0 4px" }} />

        <BtnH onClick={handleExportCSV} color="#a78bfa">📊 CSV出力</BtnH>

        <div style={{ width: 1, background: "#334155", height: 24, margin: "0 4px" }} />

        <BtnH onClick={undo} color="#64748b" disabled={historyIndex <= 0}>↩ Undo</BtnH>
        <BtnH onClick={redo} color="#64748b" disabled={historyIndex >= history.length - 1}>↪ Redo</BtnH>

        <div style={{ flex: 1 }} />

        {/* ビュー切替 */}
        <div style={{ display: "flex", gap: 2, background: "#0f172a", padding: 2, borderRadius: 6 }}>
          {["class", "teacher"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer",
              background: view === v ? "#38bdf8" : "transparent",
              color: view === v ? "#0f172a" : "#94a3b8",
              fontWeight: view === v ? 700 : 400,
              fontSize: 12,
            }}>
              {v === "class" ? "学級ビュー" : "教員ビュー"}
            </button>
          ))}
        </div>

        <div style={{ width: 1, background: "#334155", height: 24, margin: "0 4px" }} />

        {/* エラー件数 */}
        <div style={{
          background: errorCount > 0 ? "#ef4444" : "#22c55e",
          color: "white", padding: "3px 10px", borderRadius: 20,
          fontWeight: 700, fontSize: 12,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          {errorCount > 0 ? `⚠ エラー ${errorCount}件` : "✓ エラーなし"}
        </div>
        {warnCount > 0 && (
          <div style={{
            background: "#f59e0b", color: "white", padding: "3px 10px", borderRadius: 20,
            fontWeight: 700, fontSize: 12,
          }}>
            ⚡ 警告 {warnCount}件
          </div>
        )}

        <div style={{ width: 1, background: "#334155", height: 24, margin: "0 4px" }} />

        {/* 設定ボタン群 */}
        {[
          ["teachers", "👨‍🏫 教員"],
          ["classes", "🏫 学級"],
          ["meetings", "📋 会議"],
          ["days", "⏰ 時限"],
          ["placementRules", "⚙ 自動配置条件"],
          ["manual", "📖 マニュアル"],
        ].map(([key, label]) => (
          <BtnH key={key} onClick={() => setRightPanel(rightPanel === key ? null : key)} color="#475569">
            {label}
          </BtnH>
        ))}
      </header>

      {/* メインエリア */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* 左パネル：授業パレット */}
        <div style={{
          width: 200, flexShrink: 0, background: "#1e293b",
          borderRight: "1px solid #334155", display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{ padding: "8px 8px 4px", borderBottom: "1px solid #334155" }}>
            <button onClick={createLesson} style={{
              width: "100%", padding: "6px 0", background: "#38bdf8", color: "#0f172a",
              border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12,
            }}>
              ＋ 授業を作成
            </button>
            <input
              value={paletteSearch}
              onChange={e => setPaletteSearch(e.target.value)}
              placeholder="🔍 検索..."
              style={{
                width: "100%", marginTop: 4, padding: "4px 6px",
                background: "#0f172a", border: "1px solid #334155", borderRadius: 4,
                color: "#e2e8f0", fontSize: 12, boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 2, marginTop: 4, flexWrap: "wrap" }}>
              {[["all","すべて"],["unplaced","未配置"],["fixed","固定"],["errors","エラー"]].map(([v, label]) => (
                <button key={v} onClick={() => setPaletteFilter(v)} style={{
                  padding: "2px 6px", borderRadius: 4, border: "none", cursor: "pointer",
                  background: paletteFilter === v ? "#38bdf8" : "#0f172a",
                  color: paletteFilter === v ? "#0f172a" : "#94a3b8",
                  fontSize: 10, fontWeight: paletteFilter === v ? 700 : 400,
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
            {paletteItems.length === 0 && (
              <p style={{ color: "#475569", fontSize: 11, textAlign: "center", marginTop: 20 }}>
                授業がありません
              </p>
            )}
            {paletteItems.map(lesson => {
              const placed = getPlacedCount(lesson.id);
              const remaining = (lesson.weeklyHours || 1) - placed;
              const hasError = errors.some(e => e.lessonId === lesson.id);
              const teacher = teachers.find(t => t.id === lesson.teacherId);
              const color = SUBJECT_COLORS[lesson.subject] || "#94a3b8";
              const classNames = (lesson.classIds || []).map(cid =>
                classes.find(c => c.id === cid)?.name || cid
              ).join(", ");

              return (
                <div
                  key={lesson.id}
                  draggable
                  onDragStart={e => handleDragStart(e, lesson.id, null)}
                  onClick={() => { setEditLesson({ ...lesson }); setRightPanel("lesson"); }}
                  style={{
                    background: "#0f172a", border: `1px solid ${hasError ? "#ef4444" : "#334155"}`,
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 6, padding: "6px 8px", marginBottom: 4,
                    cursor: "grab", position: "relative",
                    opacity: remaining <= 0 ? 0.5 : 1,
                  }}
                >
                  <div style={{ fontWeight: 700, color, fontSize: 13 }}>
                    {lesson.subject}
                    {isLessonFixedAnywhere(lesson.id) && <span style={{ marginLeft: 4, fontSize: 10 }}>🔒</span>}
                    {hasError && <span style={{ marginLeft: 4, fontSize: 10 }}>⚠</span>}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 2 }}>{classNames}</div>
                  {teacher && <div style={{ color: "#64748b", fontSize: 10 }}>{teacher.name}</div>}
                  <div style={{
                    position: "absolute", top: 4, right: 6,
                    fontSize: 10, fontWeight: 700,
                    color: remaining > 0 ? "#22c55e" : "#475569",
                  }}>
                    残{remaining}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 中央グリッド */}
        <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
          {view === "class" ? (
            <ClassGridView
              classes={classes}
              columns={columns}
              days={days}
              placements={placements}
              lessons={lessons}
              teachers={teachers}
              errors={errors}
              collapsedGrades={collapsedGrades}
              setCollapsedGrades={setCollapsedGrades}
              gradeGroups={gradeGroups}
              dragging={dragging}
              dragOver={dragOver}
              handleDragStart={handleDragStart}
              handleDragOver={handleDragOver}
              handleDrop={handleDrop}
              handleCellLessonClick={handleCellLessonClick}
              selectedLesson={selectedLesson}
              setSelectedLesson={setSelectedLesson}
              toggleFixed={toggleFixed}
              removePlacement={removePlacement}
              isFixed={isFixed}
            />
          ) : (
            <TeacherGridView
              teachers={teachers}
              columns={columns}
              days={days}
              teacherGrid={teacherGrid}
              meetings={meetings}
              errors={errors}
            />
          )}
        </div>

        {/* 右パネル */}
        {rightPanel && (
          <div style={{
            width: 340, flexShrink: 0, background: "#1e293b",
            borderLeft: "1px solid #334155", display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 12px", borderBottom: "1px solid #334155",
            }}>
              <span style={{ fontWeight: 700 }}>
                {rightPanel === "teachers" && "👨‍🏫 教員一覧"}
                {rightPanel === "classes" && "🏫 学級一覧"}
                {rightPanel === "lesson" && "📝 授業編集"}
                {rightPanel === "meetings" && "📋 会議設定"}
                {rightPanel === "days" && "⏰ 曜日・時限設定"}
                {rightPanel === "placementRules" && "⚙ 自動配置条件"}
                {rightPanel === "manual" && "📖 マニュアル"}
              </span>
              <button onClick={() => { setRightPanel(null); setEditLesson(null); }}
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}>
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {rightPanel === "teachers" && (
                <TeacherPanel
                  teachers={teachers} setTeachers={setTeachers}
                  classes={classes} newTeacher={newTeacher} setNewTeacher={setNewTeacher}
                />
              )}
              {rightPanel === "classes" && (
                <ClassPanel
                  classes={classes} setClasses={setClasses}
                  newClass={newClass} setNewClass={setNewClass}
                />
              )}
              {rightPanel === "lesson" && editLesson && (
                <LessonPanel
                  lesson={editLesson} setLesson={setEditLesson}
                  teachers={teachers} classes={classes}
                  onSave={saveLesson} onDelete={() => deleteLesson(editLesson.id)}
                />
              )}
              {rightPanel === "meetings" && (
                <MeetingPanel
                  meetings={meetings} setMeetings={setMeetings}
                  teachers={teachers} days={days}
                  newMeeting={newMeeting} setNewMeeting={setNewMeeting}
                />
              )}
              {rightPanel === "days" && (
                <DaysPanel days={days} setDays={setDays} />
              )}
              {rightPanel === "placementRules" && (
                <PlacementRulesPanel
                  rules={placementRules} setRules={setPlacementRules}
                  classes={classes} days={days}
                  lessons={lessons}
                  onBulkCreateHomeroomLessons={bulkCreateHomeroomLessons}
                />
              )}
              {rightPanel === "manual" && <ManualPanel />}
            </div>
          </div>
        )}
      </div>

      {/* 下パネル */}
      <div style={{
        height: 180, flexShrink: 0, background: "#1e293b",
        borderTop: "1px solid #334155", display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", borderBottom: "1px solid #334155" }}>
          {[["unplaced","未配置"],["errors","エラー・警告"],["log","ログ"]].map(([t, label]) => (
            <button key={t} onClick={() => setBottomTab(t)} style={{
              padding: "6px 14px", border: "none", cursor: "pointer", fontSize: 12,
              background: bottomTab === t ? "#334155" : "transparent",
              color: bottomTab === t ? "#e2e8f0" : "#64748b",
              borderBottom: bottomTab === t ? "2px solid #38bdf8" : "2px solid transparent",
            }}>
              {label}
              {t === "unplaced" && (
                <span style={{
                  marginLeft: 4, background: "#f59e0b", color: "#0f172a",
                  borderRadius: 10, padding: "0 5px", fontSize: 10, fontWeight: 700,
                }}>
                  {lessons.reduce((acc, l) => acc + Math.max(0, (l.weeklyHours||1) - getPlacedCount(l.id)), 0)}
                </span>
              )}
              {t === "errors" && errors.length > 0 && (
                <span style={{
                  marginLeft: 4, background: "#ef4444", color: "white",
                  borderRadius: 10, padding: "0 5px", fontSize: 10, fontWeight: 700,
                }}>
                  {errors.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {bottomTab === "unplaced" && (
            <UnplacedPanel
              lessons={lessons} getPlacedCount={getPlacedCount} classes={classes} teachers={teachers}
              unplacedReasons={unplacedReasons}
            />
          )}
          {bottomTab === "errors" && (
            <ErrorsPanel errors={errors} lessons={lessons} classes={classes} />
          )}
          {bottomTab === "log" && (
            <div style={{ color: "#475569", fontSize: 11 }}>
              操作履歴: {history.length}件（Undo可能: {historyIndex}件）
            </div>
          )}
        </div>
      </div>

      {/* トースト */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 200, right: 20, maxWidth: 320,
          background: toast.type === "error" ? "#ef4444" : toast.type === "success" ? "#22c55e" : "#38bdf8",
          color: "white", padding: "10px 20px", borderRadius: 8,
          fontWeight: 700, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          whiteSpace: "pre-line", lineHeight: 1.6,
        }}>
          {toast.msg}
        </div>
      )}

      {/* 選択授業ポップアップ */}
      {selectedLesson && (
        <LessonPopup
          selectedLesson={selectedLesson}
          setSelectedLesson={setSelectedLesson}
          toggleFixed={toggleFixed}
          removePlacement={removePlacement}
          fixed={isFixed(selectedLesson.cellKey, selectedLesson.lessonId)}
          onEdit={() => {
            setEditLesson({ ...selectedLesson.lesson });
            setRightPanel("lesson");
            setSelectedLesson(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// 学級グリッドビュー
// ============================================================
function ClassGridView({
  classes, columns, days, placements, lessons, teachers, errors,
  collapsedGrades, setCollapsedGrades, gradeGroups,
  dragging, dragOver, handleDragStart, handleDragOver, handleDrop,
  handleCellLessonClick, selectedLesson, setSelectedLesson, toggleFixed, removePlacement, isFixed,
}) {
  const headerBg = "#1e293b";
  const cellBg = "#0f172a";
  const borderColor = "#1e293b";
  const dayBorder = "#334155";

  // 曜日ごとの区切り位置を計算
  let dayStartCols = {};
  let colIdx = 0;
  for (const day of days) {
    dayStartCols[day.id] = colIdx;
    colIdx += day.periods;
  }

  return (
    <div style={{ minWidth: "fit-content" }}>
      {/* ヘッダー行（曜日） */}
      <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ width: 60, flexShrink: 0, background: headerBg }} />
        {days.map(day => (
          <div key={day.id} style={{
            display: "flex", borderLeft: `2px solid ${dayBorder}`,
          }}>
            {Array.from({ length: day.periods }, (_, i) => (
              <div key={i} style={{
                width: 66, flexShrink: 0, background: headerBg,
                textAlign: "center", padding: "4px 0", fontSize: 11,
                color: "#94a3b8", fontWeight: 700,
                borderRight: `1px solid ${borderColor}`,
              }}>
                {i === 0 ? `${day.label}` : ""}{i + 1}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 学年グループ（学年混合＝特別支援学級は最後に表示） */}
      {Object.entries(gradeGroups).sort((a, b) => {
        const av = a[0] === MIXED_GRADE_KEY ? Infinity : Number(a[0]);
        const bv = b[0] === MIXED_GRADE_KEY ? Infinity : Number(b[0]);
        return av - bv;
      }).map(([grade, gradeClasses]) => (
        <div key={grade}>
          {/* 学年ヘッダー */}
          <div
            onClick={() => setCollapsedGrades(prev => ({ ...prev, [grade]: !prev[grade] }))}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px", background: "#1e3a5f", cursor: "pointer",
              borderTop: "1px solid #334155", fontSize: 12, fontWeight: 700, color: "#38bdf8",
            }}
          >
            {collapsedGrades[grade] ? "▶" : "▼"} {grade === MIXED_GRADE_KEY ? "特別支援" : `${grade}年`}
          </div>

          {/* 学級行 */}
          {!collapsedGrades[grade] && gradeClasses.map(cls => (
            <div key={cls.id} style={{ display: "flex" }}>
              {/* 学級名 */}
              <div style={{
                width: 60, flexShrink: 0, background: "#1e293b",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: "#94a3b8",
                borderBottom: `1px solid ${borderColor}`,
                borderRight: `1px solid ${dayBorder}`,
              }}>
                {cls.name}
              </div>

              {/* セル */}
              {days.map(day => (
                <div key={day.id} style={{ display: "flex", borderLeft: `2px solid ${dayBorder}` }}>
                  {Array.from({ length: day.periods }, (_, i) => {
                    const period = i + 1;
                    const key = `${cls.id}__${day.id}__${period}`;
                    const ids = placements[key] || [];
                    const isOver = dragOver === key;
                    const cellErrors = errors.filter(e => e.cellKey === key);
                    const hasError = cellErrors.some(e => e.severity === "error");
                    const hasWarn = cellErrors.some(e => e.severity === "warning");

                    return (
                      <div
                        key={period}
                        onDragOver={e => handleDragOver(e, key)}
                        onDrop={e => handleDrop(e, cls.id, day.id, period)}
                        style={{
                          width: 66, height: 44, flexShrink: 0,
                          background: isOver ? "#1e3a5f" : cellBg,
                          border: `1px solid ${hasError ? "#ef4444" : hasWarn ? "#f59e0b" : borderColor}`,
                          borderWidth: hasError || hasWarn ? 2 : 1,
                          display: "flex", flexDirection: "column",
                          alignItems: "stretch", justifyContent: "center",
                          position: "relative", cursor: "default",
                          transition: "background 0.1s",
                        }}
                      >
                        {ids.length === 0 && (
                          <div style={{
                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#1e293b", fontSize: 10,
                          }}>
                            {isOver ? "📌" : ""}
                          </div>
                        )}
                        {ids.map(lessonId => {
                          const lesson = lessons.find(l => l.id === lessonId);
                          if (!lesson) return null;
                          const color = SUBJECT_COLORS[lesson.subject] || "#94a3b8";
                          const teacher = teachers.find(t => t.id === lesson.teacherId);
                          const lErrors = errors.filter(e => e.lessonId === lessonId && e.cellKey === key);
                          const lHasError = lErrors.some(e => e.severity === "error");
                          const lHasWarn = lErrors.some(e => e.severity === "warning");
                          const fixed = isFixed(key, lessonId);

                          return (
                            <div
                              key={lessonId}
                              draggable
                              onDragStart={e => handleDragStart(e, lessonId, key)}
                              onClick={e => handleCellLessonClick(e, lessonId, key)}
                              style={{
                                flex: 1, background: color + "22",
                                borderLeft: `3px solid ${color}`,
                                padding: "1px 3px", cursor: "grab",
                                display: "flex", flexDirection: "column", justifyContent: "center",
                              }}
                            >
                              <div style={{
                                fontSize: 11, fontWeight: 700, color,
                                display: "flex", alignItems: "center", gap: 2,
                              }}>
                                {lesson.subject}
                                {fixed && <span style={{ fontSize: 8 }}>🔒</span>}
                                {(lHasError || lHasWarn) && (
                                  <span style={{ fontSize: 8, color: lHasError ? "#ef4444" : "#f59e0b" }}>⚠</span>
                                )}
                              </div>
                              {teacher && (
                                <div style={{ fontSize: 9, color: "#64748b" }}>
                                  {teacher.name.split(" ")[0]}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 教員グリッドビュー
// ============================================================
function TeacherGridView({ teachers, columns, days, teacherGrid, meetings, errors }) {
  if (!teacherGrid) return null;

  return (
    <div style={{ minWidth: "fit-content" }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ width: 80, flexShrink: 0, background: "#1e293b" }} />
        {days.map(day => (
          <div key={day.id} style={{ display: "flex", borderLeft: "2px solid #334155" }}>
            {Array.from({ length: day.periods }, (_, i) => (
              <div key={i} style={{
                width: 80, flexShrink: 0, background: "#1e293b",
                textAlign: "center", padding: "4px 0", fontSize: 11,
                color: "#94a3b8", fontWeight: 700,
                borderRight: "1px solid #1e293b",
              }}>
                {i === 0 ? day.label : ""}{i + 1}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 教員行 */}
      {teacherGrid.map(({ teacher, row }) => (
        <div key={teacher.id} style={{ display: "flex" }}>
          <div style={{
            width: 80, flexShrink: 0, background: "#1e293b",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, color: "#94a3b8",
            borderBottom: "1px solid #1e293b",
            borderRight: "1px solid #334155",
            padding: "0 4px", textAlign: "center",
          }}>
            {teacher.name.replace(" ", "\n")}
          </div>

          {days.map(day => (
            <div key={day.id} style={{ display: "flex", borderLeft: "2px solid #334155" }}>
              {Array.from({ length: day.periods }, (_, i) => {
                const period = i + 1;
                const key = `t${teacher.id}__${day.id}__${period}`;
                const items = row[key] || [];
                const hasMeeting = meetings.some(m =>
                  m.dayId === day.id && m.period === period && m.teacherIds.includes(teacher.id)
                );

                return (
                  <div key={period} style={{
                    width: 80, height: 44, flexShrink: 0,
                    background: hasMeeting ? "#1e3a5f33" : "#0f172a",
                    border: "1px solid #1e293b",
                    display: "flex", flexDirection: "column",
                    alignItems: "stretch", justifyContent: "center",
                    position: "relative",
                  }}>
                    {hasMeeting && items.length === 0 && (
                      <div style={{ fontSize: 9, color: "#64748b", textAlign: "center" }}>
                        📋会議
                      </div>
                    )}
                    {items.map(({ lesson, className }, idx) => {
                      const color = SUBJECT_COLORS[lesson.subject] || "#94a3b8";
                      return (
                        <div key={idx} style={{
                          flex: 1, background: color + "22",
                          borderLeft: `3px solid ${color}`,
                          padding: "1px 4px", display: "flex",
                          flexDirection: "column", justifyContent: "center",
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color }}>{lesson.subject}</div>
                          <div style={{ fontSize: 9, color: "#64748b" }}>{className}</div>
                        </div>
                      );
                    })}
                    {hasMeeting && items.length > 0 && (
                      <div style={{
                        position: "absolute", top: 1, right: 2,
                        fontSize: 8, color: "#f59e0b",
                      }}>⚠</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 授業ポップアップ
// ============================================================
function LessonPopup({ selectedLesson, setSelectedLesson, toggleFixed, removePlacement, fixed, onEdit }) {
  const { lessonId, cellKey, lesson } = selectedLesson;
  if (!lesson) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={() => setSelectedLesson(null)}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#1e293b", border: "1px solid #334155", borderRadius: 12,
          padding: 20, minWidth: 260, boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: SUBJECT_COLORS[lesson.subject] }}>
          {lesson.subject}
          {fixed && " 🔒"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Btn2 onClick={onEdit}>✏️ 編集</Btn2>
          <Btn2 onClick={() => toggleFixed(lessonId, cellKey)}>
            {fixed ? "🔓 固定解除" : "🔒 固定する"}
          </Btn2>
          <Btn2 onClick={() => removePlacement(lessonId, cellKey)} color="#ef4444">
            🗑 このコマから削除
          </Btn2>
          <Btn2 onClick={() => setSelectedLesson(null)} color="#475569">キャンセル</Btn2>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 各設定パネル
// ============================================================
function TeacherPanel({ teachers, setTeachers, classes, newTeacher, setNewTeacher }) {
  return (
    <div>
      <h3 style={{ color: "#38bdf8", marginBottom: 12, fontSize: 13 }}>教員一覧</h3>
      {teachers.map((t, idx) => (
        <div key={t.id} style={{
          background: "#0f172a", borderRadius: 6, padding: "8px 10px",
          marginBottom: 6, display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>{t.name}</div>
            <div style={{ fontSize: 10, color: "#64748b" }}>
              {t.homeroom ? `担任: ${classes.find(c => c.id === t.homeroom)?.name || t.homeroom}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => {
              if (idx > 0) {
                const arr = [...teachers];
                [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                setTeachers(arr);
              }
            }} style={smallBtnStyle}>↑</button>
            <button onClick={() => {
              if (idx < teachers.length - 1) {
                const arr = [...teachers];
                [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                setTeachers(arr);
              }
            }} style={smallBtnStyle}>↓</button>
            <button onClick={() => setTeachers(prev => prev.filter(tt => tt.id !== t.id))}
              style={{ ...smallBtnStyle, color: "#ef4444" }}>✕</button>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 12, padding: 10, background: "#0f172a", borderRadius: 8 }}>
        <h4 style={{ color: "#94a3b8", fontSize: 11, marginBottom: 8 }}>教員を追加</h4>
        <input value={newTeacher.name} onChange={e => setNewTeacher(p => ({ ...p, name: e.target.value }))}
          placeholder="教員名" style={inputStyle} />
        <select value={newTeacher.homeroom} onChange={e => setNewTeacher(p => ({ ...p, homeroom: e.target.value }))}
          style={{ ...inputStyle, marginTop: 4 }}>
          <option value="">担任クラスなし</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={newTeacher.note} onChange={e => setNewTeacher(p => ({ ...p, note: e.target.value }))}
          placeholder="備考" style={{ ...inputStyle, marginTop: 4 }} />
        <button onClick={() => {
          if (!newTeacher.name.trim()) return;
          setTeachers(prev => [...prev, { id: generateId(), ...newTeacher }]);
          setNewTeacher({ name: "", homeroom: "", note: "" });
        }} style={{ ...btnStyle, marginTop: 6, width: "100%" }}>
          追加
        </button>
      </div>
    </div>
  );
}

// 交流学級専用：交流先の親学級・合同で行う教科を選ぶUI（追加フォーム／既存学級の編集で共用）
function ExchangeLinkFields({ parentId, linkedSubjects, classes, excludeId, onChangeParent, onToggleSubject }) {
  const parentOptions = classes.filter(c => c.type === "normal" && c.id !== excludeId);
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>交流先の学級</div>
      <select value={parentId || ""} onChange={e => onChangeParent(e.target.value || null)} style={inputStyle}>
        <option value="">未設定</option>
        {parentOptions.map(c => <option key={c.id} value={c.id}>{c.name}（{c.grade}年）</option>)}
      </select>
      <div style={{ fontSize: 10, color: "#64748b", margin: "6px 0 2px" }}>合同で行う教科</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {SUBJECTS.map(s => (
          <label key={s} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={(linkedSubjects || []).includes(s)}
              onChange={e => onToggleSubject(s, e.target.checked)} />
            {s}
          </label>
        ))}
      </div>
      <p style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
        親学級でここに登録した教科の授業を作成すると、自動的にこの交流学級も対象クラスへ追加され、
        同じコマへ同時に配置されるようになります。
      </p>
    </div>
  );
}

function ClassPanel({ classes, setClasses, newClass, setNewClass }) {
  return (
    <div>
      <h3 style={{ color: "#38bdf8", marginBottom: 12, fontSize: 13 }}>学級一覧</h3>
      {classes.map(cls => (
        <div key={cls.id} style={{
          background: "#0f172a", borderRadius: 6, padding: "8px 10px",
          marginBottom: 4,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 700, fontSize: 12 }}>{cls.name}</span>
              <span style={{ fontSize: 10, color: "#64748b", marginLeft: 6 }}>
                {cls.grade != null ? `${cls.grade}年` : "特別支援"} / {cls.type === "normal" ? "通常" : cls.type === "special" ? "特支" : "交流"}
              </span>
            </div>
            <button onClick={() => setClasses(prev => prev.filter(c => c.id !== cls.id))}
              style={{ ...smallBtnStyle, color: "#ef4444" }}>✕</button>
          </div>
          {cls.type === "exchange" && (
            <ExchangeLinkFields
              parentId={cls.parentId}
              linkedSubjects={cls.linkedSubjects}
              classes={classes}
              excludeId={cls.id}
              onChangeParent={parentId => setClasses(prev => prev.map(c => c.id === cls.id ? { ...c, parentId } : c))}
              onToggleSubject={(subject, checked) => setClasses(prev => prev.map(c => {
                if (c.id !== cls.id) return c;
                const prevSubjects = c.linkedSubjects || [];
                return {
                  ...c,
                  linkedSubjects: checked ? [...prevSubjects, subject] : prevSubjects.filter(s => s !== subject),
                };
              }))}
            />
          )}
        </div>
      ))}

      <div style={{ marginTop: 12, padding: 10, background: "#0f172a", borderRadius: 8 }}>
        <h4 style={{ color: "#94a3b8", fontSize: 11, marginBottom: 8 }}>学級を追加</h4>
        <input value={newClass.name} onChange={e => setNewClass(p => ({ ...p, name: e.target.value }))}
          placeholder="学級名（例: 1-4）" style={inputStyle} />
        <select value={newClass.type} onChange={e => setNewClass(p => ({ ...p, type: e.target.value }))}
          style={{ ...inputStyle, marginTop: 4 }}>
          <option value="normal">通常</option>
          <option value="special">特支</option>
          <option value="exchange">交流</option>
        </select>
        {isGradelessClassType(newClass.type) ? (
          <p style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>
            {newClass.type === "special"
              ? "特支は学年をまたぐことがあるため、学年は設定しません（時間割グリッドの「特別支援」に表示されます）。"
              : "交流学級は学年を設定しません（学級名に学年を含めてください。例: 特支1（1年）／時間割グリッドの「特別支援」に表示されます）。"}
          </p>
        ) : (
          <select value={newClass.grade} onChange={e => setNewClass(p => ({ ...p, grade: Number(e.target.value) }))}
            style={{ ...inputStyle, marginTop: 4 }}>
            {[1, 2, 3, 4, 5, 6].map(g => <option key={g} value={g}>{g}年</option>)}
          </select>
        )}
        {newClass.type === "exchange" && (
          <ExchangeLinkFields
            parentId={newClass.parentId}
            linkedSubjects={newClass.linkedSubjects}
            classes={classes}
            excludeId={null}
            onChangeParent={parentId => setNewClass(p => ({ ...p, parentId }))}
            onToggleSubject={(subject, checked) => setNewClass(p => {
              const prevSubjects = p.linkedSubjects || [];
              return {
                ...p,
                linkedSubjects: checked ? [...prevSubjects, subject] : prevSubjects.filter(s => s !== subject),
              };
            })}
          />
        )}
        <button onClick={() => {
          if (!newClass.name.trim()) return;
          const toAdd = {
            id: generateId(),
            ...newClass,
            grade: isGradelessClassType(newClass.type) ? null : newClass.grade,
            parentId: newClass.type === "exchange" ? newClass.parentId : null,
            linkedSubjects: newClass.type === "exchange" ? newClass.linkedSubjects : [],
          };
          setClasses(prev => [...prev, toAdd].sort((a, b) => gradeSortValue(a.grade) - gradeSortValue(b.grade)));
          setNewClass({ name: "", grade: 1, type: "normal", parentId: null, linkedSubjects: [] });
        }} style={{ ...btnStyle, marginTop: 6, width: "100%" }}>
          追加
        </button>
      </div>
    </div>
  );
}

function LessonPanel({ lesson, setLesson, teachers, classes, onSave, onDelete }) {
  return (
    <div>
      <h3 style={{ color: "#38bdf8", marginBottom: 12, fontSize: 13 }}>授業編集</h3>

      <FormRow label="教科">
        <select value={lesson.subject || ""} onChange={e => setLesson(p => withAutoLinkedExchangeClasses({ ...p, subject: e.target.value }, classes))}
          style={inputStyle}>
          {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </FormRow>

      <FormRow label="対象クラス（複数可）">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {classes.map(cls => {
            const isAutoLinked = cls.type === "exchange"
              && getLinkedExchangeClassIds(cls.parentId, lesson.subject, classes).includes(cls.id)
              && (lesson.classIds || []).some(id => id !== cls.id && getLinkedExchangeClassIds(id, lesson.subject, classes).includes(cls.id));
            return (
              <label key={cls.id} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                <input type="checkbox"
                  checked={lesson.classIds?.includes(cls.id) || false}
                  onChange={e => {
                    const prev = lesson.classIds || [];
                    const nextIds = e.target.checked ? [...prev, cls.id] : prev.filter(id => id !== cls.id);
                    setLesson(p => withAutoLinkedExchangeClasses({ ...p, classIds: nextIds }, classes));
                  }}
                />
                <span style={{ fontSize: 11 }}>
                  {cls.name}{isAutoLinked && <span title="親学級の連携設定により自動追加されています" style={{ color: "#38bdf8" }}>（自動）</span>}
                </span>
              </label>
            );
          })}
        </div>
      </FormRow>

      <FormRow label="担当教員">
        <select value={lesson.teacherId || ""} onChange={e => setLesson(p => ({ ...p, teacherId: e.target.value }))}
          style={inputStyle}>
          <option value="">未定</option>
          {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </FormRow>

      <FormRow label="副担当教員">
        <select value={lesson.subTeacherIds?.[0] || ""} onChange={e => setLesson(p => ({
          ...p, subTeacherIds: e.target.value ? [e.target.value] : []
        }))} style={inputStyle}>
          <option value="">なし</option>
          {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </FormRow>

      <FormRow label="週時数">
        <input type="number" min={1} max={10} value={lesson.weeklyHours || 1}
          onChange={e => setLesson(p => ({ ...p, weeklyHours: Number(e.target.value) }))}
          style={{ ...inputStyle, width: 60 }} />
      </FormRow>

      <FormRow label="配置方法">
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={lesson.simultaneous || false}
            onChange={e => setLesson(p => ({ ...p, simultaneous: e.target.checked }))} />
          <span style={{ fontSize: 11 }}>選択クラスを同じ時間に配置（合同授業）</span>
        </label>
      </FormRow>

      <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
        <button onClick={onSave} style={{ ...btnStyle, flex: 1, background: "#22c55e", color: "#0f172a" }}>
          💾 保存
        </button>
        <button onClick={onDelete} style={{ ...btnStyle, background: "#ef4444", color: "white" }}>
          🗑 削除
        </button>
      </div>
    </div>
  );
}

function MeetingPanel({ meetings, setMeetings, teachers, days, newMeeting, setNewMeeting }) {
  return (
    <div>
      <h3 style={{ color: "#38bdf8", marginBottom: 12, fontSize: 13 }}>会議設定</h3>
      {meetings.map(m => (
        <div key={m.id} style={{
          background: "#0f172a", borderRadius: 6, padding: "8px 10px", marginBottom: 6,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{m.name}</span>
            <button onClick={() => setMeetings(prev => prev.filter(mm => mm.id !== m.id))}
              style={{ ...smallBtnStyle, color: "#ef4444" }}>✕</button>
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            {days.find(d => d.id === m.dayId)?.label || m.dayId}曜{m.period}限 / {m.teacherIds.length}名
          </div>
        </div>
      ))}

      <div style={{ marginTop: 12, padding: 10, background: "#0f172a", borderRadius: 8 }}>
        <h4 style={{ color: "#94a3b8", fontSize: 11, marginBottom: 8 }}>会議を追加</h4>
        <input value={newMeeting.name} onChange={e => setNewMeeting(p => ({ ...p, name: e.target.value }))}
          placeholder="会議名" style={inputStyle} />
        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <select value={newMeeting.dayId} onChange={e => setNewMeeting(p => ({ ...p, dayId: e.target.value }))}
            style={{ ...inputStyle, flex: 1 }}>
            {days.map(d => <option key={d.id} value={d.id}>{d.label}曜</option>)}
          </select>
          <select value={newMeeting.period} onChange={e => setNewMeeting(p => ({ ...p, period: Number(e.target.value) }))}
            style={{ ...inputStyle, width: 60 }}>
            {[1,2,3,4,5,6].map(p => <option key={p} value={p}>{p}限</option>)}
          </select>
        </div>
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>対象教員（複数可）</div>
          {teachers.map(t => (
            <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2, cursor: "pointer" }}>
              <input type="checkbox"
                checked={newMeeting.teacherIds.includes(t.id)}
                onChange={e => setNewMeeting(p => ({
                  ...p,
                  teacherIds: e.target.checked
                    ? [...p.teacherIds, t.id]
                    : p.teacherIds.filter(id => id !== t.id)
                }))}
              />
              <span style={{ fontSize: 11 }}>{t.name}</span>
            </label>
          ))}
        </div>
        <button onClick={() => {
          if (!newMeeting.name.trim()) return;
          setMeetings(prev => [...prev, { id: generateId(), ...newMeeting }]);
          setNewMeeting({ name: "", teacherIds: [], dayId: "mon", period: 1 });
        }} style={{ ...btnStyle, marginTop: 8, width: "100%" }}>
          追加
        </button>
      </div>
    </div>
  );
}

function DaysPanel({ days, setDays }) {
  return (
    <div>
      <h3 style={{ color: "#38bdf8", marginBottom: 12, fontSize: 13 }}>曜日・時限設定</h3>
      <p style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>各曜日の時限数を設定します</p>
      {days.map(day => (
        <div key={day.id} style={{
          display: "flex", alignItems: "center", gap: 10,
          marginBottom: 8, background: "#0f172a", padding: "8px 10px", borderRadius: 6,
        }}>
          <span style={{ fontWeight: 700, width: 30, color: "#94a3b8" }}>{day.label}曜</span>
          <input
            type="number" min={1} max={8} value={day.periods}
            onChange={e => setDays(prev => prev.map(d =>
              d.id === day.id ? { ...d, periods: Number(e.target.value) } : d
            ))}
            style={{ ...inputStyle, width: 60, textAlign: "center" }}
          />
          <span style={{ fontSize: 11, color: "#64748b" }}>時限</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 自動配置条件パネル
// ============================================================
function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 12, border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
          padding: "8px 10px", background: "#0f172a", fontWeight: 700, fontSize: 12, color: "#38bdf8",
        }}
      >
        <span>{open ? "▼" : "▶"}</span>{title}
      </div>
      {open && <div style={{ padding: 10 }}>{children}</div>}
    </div>
  );
}

// 学年固定用：曜日×時限から1コマだけ選ぶピッカー（選択中をもう一度押すと解除）
function SingleSlotPicker({ days, value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {days.map(day => Array.from({ length: day.periods }, (_, i) => i + 1).map(p => {
        const selected = value && value.dayId === day.id && value.period === p;
        return (
          <label key={`${day.id}-${p}`} style={{
            display: "flex", alignItems: "center", gap: 2, fontSize: 10, cursor: "pointer",
            background: selected ? "#38bdf822" : "transparent", padding: "1px 3px", borderRadius: 3,
          }}>
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onChange(selected ? null : { dayId: day.id, period: p })}
            />
            {day.label}{p}
          </label>
        );
      }))}
    </div>
  );
}

// 教科ごとの配置禁止時間用：時限番号（曜日問わず）の複数選択
function PeriodMultiPicker({ maxPeriod, values, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {Array.from({ length: maxPeriod }, (_, i) => i + 1).map(p => (
        <label key={p} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={values.includes(p)}
            onChange={e => onChange(e.target.checked ? [...values, p] : values.filter(v => v !== p))}
          />
          {p}限
        </label>
      ))}
    </div>
  );
}

function PlacementRulesPanel({ rules, setRules, classes, days, lessons, onBulkCreateHomeroomLessons }) {
  const maxPeriod = Math.max(6, ...days.map(d => d.periods));
  const grades = [...new Set(classes.map(c => c.grade).filter(g => g != null))].sort((a, b) => a - b);

  const updateRules = (patch) => setRules(prev => ({ ...prev, ...patch }));

  return (
    <div>
      <h3 style={{ color: "#38bdf8", marginBottom: 12, fontSize: 13 }}>⚙ 自動配置条件</h3>
      <p style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
        自動生成・再配置がここでの条件を優先して配置します。
      </p>

      <CollapsibleSection title="教員条件">
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, fontWeight: 700 }}>教員の連続授業上限</div>
        {CONSECUTIVE_LIMIT_OPTIONS.map(opt => (
          <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, cursor: "pointer", fontSize: 11 }}>
            <input type="radio" name="consecutiveLimit" checked={rules.teacherConsecutive.mode === opt.value}
              onChange={() => updateRules({ teacherConsecutive: { ...rules.teacherConsecutive, mode: opt.value } })}
            />
            {opt.label}
          </label>
        ))}
        {rules.teacherConsecutive.mode === "custom" && (
          <input type="number" min={2} max={6} value={rules.teacherConsecutive.customValue}
            onChange={e => updateRules({ teacherConsecutive: { ...rules.teacherConsecutive, customValue: Number(e.target.value) } })}
            style={{ ...inputStyle, width: 60, marginTop: 4 }}
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="教科条件">
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
            <input type="checkbox" checked={rules.sameSubjectSameDay}
              onChange={e => updateRules({ sameSubjectSameDay: e.target.checked })}
            />
            同一教科を同日に配置しない
          </label>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, fontWeight: 700 }}>教科ごとの配置禁止時間</div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {SUBJECTS.map(subject => (
              <div key={subject} style={{ marginBottom: 6, background: "#0f172a", padding: "6px 8px", borderRadius: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{subject}</div>
                <PeriodMultiPicker
                  maxPeriod={maxPeriod}
                  values={rules.subjectForbiddenPeriods[subject] || []}
                  onChange={vals => updateRules({
                    subjectForbiddenPeriods: { ...rules.subjectForbiddenPeriods, [subject]: vals }
                  })}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, fontWeight: 700 }}>同じ時間帯に配置しない教科（学年単位で判定）</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SUBJECTS.map(subject => (
              <label key={subject} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={rules.simultaneousForbiddenSubjects.includes(subject)}
                  onChange={e => updateRules({
                    simultaneousForbiddenSubjects: e.target.checked
                      ? [...rules.simultaneousForbiddenSubjects, subject]
                      : rules.simultaneousForbiddenSubjects.filter(s => s !== subject)
                  })}
                />
                {subject}
              </label>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="学級条件">
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8, fontWeight: 700 }}>学年単位で固定する教科</div>
        {grades.length === 0 && (
          <p style={{ fontSize: 10, color: "#475569" }}>学級が登録されていません</p>
        )}
        {GRADE_FIXABLE_SUBJECTS.map(subject => {
          const conf = rules.gradeFixedSubjects[subject];
          return (
            <div key={subject} style={{ marginBottom: 10, background: "#0f172a", padding: "8px 10px", borderRadius: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                <input type="checkbox" checked={conf.enabled}
                  onChange={e => updateRules({
                    gradeFixedSubjects: { ...rules.gradeFixedSubjects, [subject]: { ...conf, enabled: e.target.checked } }
                  })}
                />
                {subject}
              </label>
              {conf.enabled && grades.map(grade => {
                const slot = conf.perGrade[grade] || null;
                const gradeClasses = classes.filter(c => c.grade === grade);
                const withLesson = gradeClasses.filter(c =>
                  lessons.some(l => l.subject === subject && (l.classIds || []).includes(c.id))
                ).length;
                return (
                  <div key={grade} style={{ marginBottom: 6, paddingLeft: 8 }}>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>{grade}年</div>
                    <SingleSlotPicker
                      days={days}
                      value={slot}
                      onChange={newSlot => updateRules({
                        gradeFixedSubjects: {
                          ...rules.gradeFixedSubjects,
                          [subject]: { ...conf, perGrade: { ...conf.perGrade, [grade]: newSlot } }
                        }
                      })}
                    />
                    {slot && (
                      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: "#64748b" }}>
                          授業が設定済みの学級: {withLesson}/{gradeClasses.length}
                        </span>
                        <button onClick={() => onBulkCreateHomeroomLessons(subject, grade)} style={{
                          fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "1px solid #38bdf844",
                          background: "#38bdf811", color: "#38bdf8", cursor: "pointer",
                        }}>
                          学級担任で不足分を自動作成
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </CollapsibleSection>

      <CollapsibleSection title="バランス調整">
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          <input type="checkbox" checked={rules.balanceMainSubjects}
            onChange={e => updateRules({ balanceMainSubjects: e.target.checked })}
          />
          主要5教科を均等配置する
        </label>
        <p style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
          対象: {MAIN_SUBJECTS.join("・")}
        </p>
      </CollapsibleSection>
    </div>
  );
}

function UnplacedPanel({ lessons, getPlacedCount, classes, teachers, unplacedReasons }) {
  const unplaced = lessons.filter(l => {
    const placed = getPlacedCount(l.id);
    return placed < (l.weeklyHours || 1);
  });

  if (unplaced.length === 0) {
    return <p style={{ color: "#22c55e", fontSize: 12, padding: 4 }}>✓ すべての授業が配置済みです</p>;
  }

  const reasonEntries = unplaced
    .map(l => ({ lesson: l, reasons: unplacedReasons?.[l.id] }))
    .filter(e => e.reasons && e.reasons.length > 0);

  return (
    <div>
      {reasonEntries.length > 0 && (
        <div style={{
          marginBottom: 10, background: "#2a1215", border: "1px solid #ef4444",
          borderRadius: 6, padding: "8px 10px",
        }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#fca5a5", marginBottom: 6 }}>
            配置できなかった理由
          </div>
          {reasonEntries.map(({ lesson, reasons }) => {
            const classNames = (lesson.classIds || []).map(id => classes.find(c => c.id === id)?.name || id).join(", ");
            return (
              <div key={lesson.id} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#fca5a5" }}>
                  ■ {lesson.subject}（{classNames}）
                </div>
                {reasons.map(r => (
                  <div key={r} style={{ fontSize: 11, color: "#fecaca", paddingLeft: 10 }}>・{r}</div>
                ))}
              </div>
            );
          })}
          <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 4 }}>
            （直近の自動生成・再配置の時点の情報です）
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {unplaced.map(l => {
        const placed = getPlacedCount(l.id);
        const remaining = (l.weeklyHours || 1) - placed;
        const color = SUBJECT_COLORS[l.subject] || "#94a3b8";
        const classNames = (l.classIds || []).map(id => classes.find(c => c.id === id)?.name || id).join(", ");
        const teacher = teachers.find(t => t.id === l.teacherId);

        return (
          <div key={l.id} style={{
            background: "#0f172a", border: `1px solid ${color}44`,
            borderLeft: `3px solid ${color}`, borderRadius: 4,
            padding: "3px 8px", fontSize: 11,
          }}>
            <span style={{ color, fontWeight: 700 }}>{l.subject}</span>
            <span style={{ color: "#64748b", marginLeft: 4 }}>{classNames}</span>
            <span style={{ color: "#f59e0b", marginLeft: 4, fontWeight: 700 }}>残{remaining}</span>
          </div>
        );
        })}
      </div>
    </div>
  );
}

function ErrorsPanel({ errors, lessons, classes }) {
  if (errors.length === 0) {
    return <p style={{ color: "#22c55e", fontSize: 12, padding: 4 }}>✓ エラーはありません</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {errors.map(err => {
        const lesson = lessons.find(l => l.id === err.lessonId);
        const [classId, dayId, period] = err.cellKey.split("__");
        const cls = classes.find(c => c.id === classId);

        return (
          <div key={err.id} style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "#0f172a", padding: "4px 8px", borderRadius: 4,
            borderLeft: `3px solid ${err.severity === "error" ? "#ef4444" : "#f59e0b"}`,
          }}>
            <span style={{ fontSize: 11 }}>{err.severity === "error" ? "⚠️" : "⚡"}</span>
            <span style={{ fontSize: 11, flex: 1, color: err.severity === "error" ? "#fca5a5" : "#fcd34d" }}>
              {err.message}
            </span>
            <span style={{ fontSize: 10, color: "#64748b" }}>
              {cls?.name} {dayId}{period}限
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// マニュアルパネル
// ============================================================
function ManualPanel() {
  const [section, setSection] = useState("start");

  const sections = [
    ["start", "はじめに"],
    ["setup", "初期設定"],
    ["special_needs", "特別支援学級について"],
    ["lesson", "授業作成"],
    ["fixed", "固定コマ"],
    ["auto", "自動生成"],
    ["autoRules", "自動配置条件（Ver1.2）"],
    ["manual_op", "手動調整"],
    ["error", "エラー確認"],
    ["output", "出力"],
    ["save", "保存と復元"],
    ["trouble", "よくあるトラブル"],
  ];

  const content = {
    start: `
# このアプリでできること

**時間割くん**は、中学校の時間割を直感的に作成・調整できるWebツールです。

## 基本的な考え方

- **自動生成**で下書きを作ります
- 下書きを**ドラッグ＆ドロップ**で手動調整して完成させます
- すべてのデータはあなたのパソコン内にだけ保存されます（外部送信なし）

## 画面の構成

- **左パネル**：授業パレット（授業の一覧と作成）
- **中央グリッド**：時間割表（操作のメイン）
- **右パネル**：各種設定（教員・学級・会議など）
- **下パネル**：未配置・エラー・ログ
    `,
    setup: `
# 初期設定の手順

## 1. 曜日・時限設定
ヘッダーの「⏰ 時限」をクリックして、各曜日の時限数を設定します。
初期値：月5限、火〜金6限

## 2. 学級登録
「🏫 学級」をクリックし、学級名・学年・種別を登録します。
例：1-1 / 1年 / 通常

## 3. 教員登録
「👨‍🏫 教員」をクリックし、教員名を登録します。
↑↓ボタンで並び順を変更できます。
教員時間割の表示順はこの並び順と一致します。

## 4. 会議設定
「📋 会議」をクリックし、定例会議を登録します。
登録した会議コマには教員が配置されないよう自動生成が制御されます。
    `,
    special_needs: `
# 特別支援学級について

特別支援学級の授業には大きく分けて2つのパターンがあるため、
学級の「種別」を使い分けて登録します。

## 1. 特別支援学級のみで行う授業（自立・作業・生単など）
学級の種別を **「特支」** にして登録します。
特支学級は学年をまたいで編成されることが多いため、
学級追加時に学年の指定は不要です（学年選択欄が表示されません）。

特支学級の授業は、通常の学級と同じように「授業を作成」→
対象クラスに特支学級を選ぶだけで配置できます。

## 2. 親学級と合同で行う授業（技能教科など）
交流学級を作成します。種別は **「交流」** にしてください。
交流学級も特支学級と同様、学年をまたいで運用されることがあるため
学年の指定は不要です（学年選択欄は表示されません）。
学年を区別したい場合は学級名に含めてください。
例：「特支1（1年）」「特支1（2年）」のように、対応する学年ごとに
別の交流学級を作ります。

### 交流先の自動連携
交流学級を作成・編集する画面（🏫 学級）で、以下の2つを設定できます。

- **交流先の学級**：合同授業を行う親学級
- **合同で行う教科**：親学級と合同で行う教科（複数選択可）

これを設定しておくと、**親学級の授業を作成する際に自動で交流学級が
対象クラスへ追加され、「同じ時間に配置（合同授業）」も自動でONになります**。
毎回手動で交流学級にチェックを入れる必要はありません。

自動生成・再配置でも、親学級と交流学級は必ず同じコマへ同時に配置されます。
時間割グリッド上で親学級側のコマをドラッグ移動・削除・固定すると、
交流学級側の対応するコマも自動的に連動します（逆方向も同様です）。

## 時間割グリッドでの表示
特支学級・交流学級（どちらも学年を指定していない学級）は、
時間割表の一番下に「特別支援」というセクションでまとめて表示されます。
    `,
    lesson: `
# 授業の作成

## 基本の手順
1. 左パネルの「＋ 授業を作成」をクリック
2. 右パネルで教科・クラス・担当教員・週時数を設定
3. 「💾 保存」をクリック

## 複数クラスへの配置
「対象クラス」で複数のクラスにチェックを入れます。

## 合同授業（同時配置）
複数クラスを選択した後、「選択クラスを同じ時間に配置」にチェックを入れます。
例：1年全クラスで同時に道徳を行う場合

## 道徳・学活の一括設定
対象クラス全選択 → 同時配置にチェック → 週時数1
→ 自動生成で同じ時間に配置されます
    `,
    fixed: `
# 固定コマの設定

特定の授業を決まった時間に固定する方法です。

## 手順
1. 左パネルから授業カードを時間割グリッドへドラッグ
2. 配置した授業をクリック
3. 「🔒 固定する」を選択

固定された授業には 🔒 マークが表示されます。
固定されたコマは自動生成・再配置の対象外になります。

## 固定解除
固定された授業をクリック → 「🔓 固定解除」を選択
    `,
    auto: `
# 自動生成の使い方

## 基本の流れ
1. 授業をすべて作成する
2. 固定コマがあれば事前に配置・ロックする
3. ヘッダーの「⚡ 自動生成」をクリック

## 自動生成の仕組み
- 固定コマを除いて、未配置の授業を順番に配置します
- 教員重複・会議コマ・同日同教科を避けるよう配置します
- ランダム性があるため、何度か実行すると異なる結果が出ます

## 自動生成後の確認
- 下パネルの「未配置」タブで配置漏れを確認
- 「エラー」タブでエラーを確認
- 必要に応じて手動調整を行います
    `,
    autoRules: `
# 自動配置条件（Ver1.2で追加）

ヘッダーの「⚙ 自動配置条件」から、自動生成・再配置のルールを細かく設定できます。
設定はブラウザ保存・JSON保存の両方に含まれ、読み込み時にも復元されます。

## 教員条件：連続授業上限
教員が1日に連続して授業を担当できるコマ数の上限です。
「制限なし」「最大2〜4時間」「任意入力（2〜6）」から選べます（初期値：最大4時間）。
上限を超える配置は自動生成で強く回避されます。

## 教科条件：同一教科を同日に配置しない
ONにすると、同じクラス・同じ日に同じ教科を2回配置することを自動生成では行いません
（OFFの場合は従来どおり「同日同教科」として警告のみ表示されます）。

## 教科条件：教科ごとの配置禁止時間
教科ごとに「◯限には配置しない」という時限を指定できます。
例：体育を5・6限に配置しない、など。指定した時限は自動生成でほぼ選ばれなくなり、
手動で配置した場合はエラー（配置禁止時間）として表示されます。

## 教科条件：同じ時間帯に配置しない教科
学年内で同時に配置したくない教科の組み合わせを登録します。
例：数学と英語を登録すると、同じ学年の別クラスで数学と英語が同じ時間に
並ぶ配置を自動生成では避けます（少人数指導や教員の掛け持ちを考慮するためです）。
判定は学年単位で行われます。

## 学級条件：学年単位で固定する教科
学活・道徳・総合について、学年ごとに固定するコマ（例：火曜5限）を指定できます。
指定すると、自動生成時にその学年の全クラスへ自動的に同じコマへ配置されます。
学年ごとに別々のコマを設定できます。

これらの教科は「学年全体で同じ時間に、各クラスはそれぞれの学級担任が
担当する」という運用が一般的です。コマを指定すると「学級担任で不足分を
自動作成」ボタンが表示され、クリックするとその学年でまだ授業が
登録されていない学級について、学級担任（教員一覧で「担任クラス」に
設定した教員）を担当教員とする授業が自動で作成されます（週時数1）。
すでに授業がある学級はスキップされ、上書きされません。担任が未設定の
学級は担当教員「未定」で作成されるので、後から手動で設定してください。

## バランス調整：主要5教科を均等配置する
国語・数学・英語・理科・社会が特定の曜日に偏らないよう、自動生成時に
同じ日にすでに主要教科が配置されている場合はその日を避けやすくします
（初期値：ON）。

## 自動生成のスコア方式
各コマの候補はスコアで評価され、最も高いコマへ配置されます。
固定コマはそもそも候補から除外され、教員重複・会議コマ・連続授業超過・
禁止時間・同時間教科重複などは大きな減点として扱われます。
    `,
    manual_op: `
# 手動調整の方法

## 授業の移動
- 授業カードをドラッグして別のコマにドロップします

## 授業の入替
- 授業があるコマに別の授業をドロップすると、そのコマに重ねて配置できます
- 元のコマから削除するには、授業をクリック → 「🗑 このコマから削除」

## 固定コマへの配置
- 固定コマには原則配置できません

## Undo / Redo
- ヘッダーの「↩ Undo」「↪ Redo」で操作を取り消し・やり直しができます

## 学年の折りたたみ
- グリッドの学年ヘッダーをクリックすると折りたたみできます
    `,
    error: `
# エラーの確認と対処

## エラーの見方
- **赤枠**：配置エラー（教員重複、会議コマなど）
- **黄枠**：警告（同日同教科など）
- ⚠ マーク：エラーのある授業カード

## 主なエラーの種類
- **教員重複**：同じ教員が同じ時間に2か所に配置されています
- **会議コマ配置**：会議時間に教員が授業担当になっています
- **同日同教科**：同じ日に同じ教科が同じクラスで2回あります

## 対処方法
1. 下パネルの「エラー・警告」タブでエラー一覧を確認
2. エラーのある授業をドラッグして別のコマに移動
3. エラーが消えるまで調整を続ける
    `,
    output: `
# 出力方法

## CSV出力（Excel対応）
ヘッダーの「📊 CSV出力」をクリック
→ Excelで開ける形式でダウンロードされます

## JSON出力
「📤 JSON出力」をクリック
→ アプリのデータをJSONファイルとして保存します

## エラーがある場合
出力時にエラーが残っている場合は確認ダイアログが表示されます。
確認後に出力を続行することもできます。
    `,
    save: `
# 保存と復元

## ブラウザ内自動保存
「💾 保存」をクリックすると、ブラウザ内（localStorage）に保存されます。
次回アクセス時に自動的に読み込まれます。

## JSONファイルに保存
「📤 JSON出力」でJSONファイルとして保存できます。
バックアップとして活用してください。

## JSONファイルから読み込み
「📂 読み込み」をクリックして、保存したJSONファイルを選択します。

## 🔒 プライバシーについて
このアプリは外部サーバーにデータを送信しません。
教員名・学級名・時間割情報はすべてあなたのパソコン内にのみ保存されます。
    `,
    trouble: `
# よくあるトラブル

## 授業が置けない
→ 固定コマの上には配置できません。固定を解除してから配置してください。

## エラーが消えない
→ 教員重複の場合、どちらかの授業を別の時間に移動してください。
→ 会議コマの場合、会議設定を変更するか、授業を別コマへ移動してください。

## 自動生成で未配置が多い
→ 教員数に対して授業数が多すぎる可能性があります。
→ 「🔄 再配置」を何度か試してみてください。
→ 週時数の設定を確認してください。

## 教員時間割に反映されない
→ 授業に担当教員が設定されているか確認してください。
→ 上部の「教員ビュー」ボタンで確認できます。

## データが消えた
→ 「📂 読み込み」でJSONファイルから復元できます。
→ 定期的にJSONファイルに保存することをお勧めします。
    `,
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
        {sections.map(([id, label]) => (
          <button key={id} onClick={() => setSection(id)} style={{
            padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer",
            background: section === id ? "#38bdf8" : "#0f172a",
            color: section === id ? "#0f172a" : "#94a3b8",
            fontSize: 10, fontWeight: section === id ? 700 : 400,
          }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{
        background: "#0f172a", padding: 12, borderRadius: 8,
        fontSize: 11, lineHeight: 1.8, color: "#cbd5e1",
        whiteSpace: "pre-wrap",
      }}>
        {content[section] || ""}
      </div>
    </div>
  );
}

// ============================================================
// スタイルヘルパー
// ============================================================
function BtnH({ onClick, color, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={btnHStyle(color, disabled)}
    >
      {children}
    </button>
  );
}

const btnHStyle = (color = "#475569", disabled = false) => ({
  padding: "4px 10px", borderRadius: 6, border: "none", cursor: disabled ? "not-allowed" : "pointer",
  background: disabled ? "#1e293b" : color + "22",
  color: disabled ? "#475569" : color,
  fontSize: 12, fontWeight: 600,
  opacity: disabled ? 0.5 : 1,
  transition: "all 0.15s",
});

function Btn2({ onClick, color = "#38bdf8", children }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 12px", borderRadius: 6, border: `1px solid ${color}44`,
      cursor: "pointer", background: color + "11", color,
      fontSize: 12, fontWeight: 600, textAlign: "left",
    }}>
      {children}
    </button>
  );
}

const btnStyle = {
  padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer",
  background: "#38bdf8", color: "#0f172a", fontSize: 12, fontWeight: 700,
};

const smallBtnStyle = {
  padding: "2px 6px", borderRadius: 4, border: "1px solid #334155",
  cursor: "pointer", background: "#0f172a", color: "#94a3b8", fontSize: 11,
};

const inputStyle = {
  width: "100%", padding: "5px 8px",
  background: "#1e293b", border: "1px solid #334155",
  borderRadius: 4, color: "#e2e8f0", fontSize: 12, boxSizing: "border-box",
};

function FormRow({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 10, color: "#94a3b8", display: "block", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
