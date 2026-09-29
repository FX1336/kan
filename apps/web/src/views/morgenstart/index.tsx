import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { endOfDay, endOfWeek, format, isPast, isToday } from "date-fns";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HiOutlineClock, HiOutlineExclamationTriangle } from "react-icons/hi2";

import Button from "~/components/Button";
import { PageHead } from "~/components/PageHead";
import { useFocusLock } from "~/providers/focus-lock";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import type { RouterOutputs } from "~/utils/api";
import { api } from "~/utils/api";

type FocusSuggestion =
  RouterOutputs["morgenstart"]["getFocusSuggestions"][number];

type Step =
  | "activate"
  | "dump"
  | "review"
  | "focus"
  | "micro"
  | "timer"
  | "afterTimer"
  | "nextTask"
  | "alreadyDone";

interface ChosenTask {
  title: string;
  cardPublicId: string | null;
  boardPublicId: string | null;
}

interface DayState {
  completed: boolean;
  chosenTask: ChosenTask | null;
  microstepText: string;
}

const DEFAULT_TIMER_SECONDS = 5 * 60;
const EXTEND_OPTIONS_MIN = [15, 30, 45];

const todayKey = () => new Date().toISOString().slice(0, 10);

const dayStorageKey = (workspacePublicId: string) =>
  `kan_morgenstart:${workspacePublicId}:${todayKey()}`;

const targetListStorageKey = (workspacePublicId: string) =>
  `kan_morgenstart_target_list:${workspacePublicId}`;

const loadDayState = (workspacePublicId: string): DayState => {
  try {
    const raw = localStorage.getItem(dayStorageKey(workspacePublicId));
    if (raw) return JSON.parse(raw) as DayState;
  } catch {
    // ignore malformed localStorage content
  }
  return { completed: false, chosenTask: null, microstepText: "" };
};

const saveDayState = (workspacePublicId: string, state: DayState) => {
  try {
    localStorage.setItem(
      dayStorageKey(workspacePublicId),
      JSON.stringify(state),
    );
  } catch {
    // storage may be unavailable (private browsing, quota) - safe to ignore
  }
};

const lastMicrostepFor = (workspacePublicId: string, title: string) => {
  try {
    const prefix = `kan_morgenstart:${workspacePublicId}:`;
    const keys = Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix) && key !== dayStorageKey(workspacePublicId))
      .sort()
      .reverse();

    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const state = JSON.parse(raw) as DayState;
      if (state.chosenTask?.title === title && state.microstepText) {
        return state.microstepText;
      }
    }
  } catch {
    // ignore malformed localStorage content
  }
  return null;
};

const getImpulses = () => [
  t`Stand up for a moment and have a good stretch.`,
  t`Grab a glass of water and take a few sips.`,
  t`Open the window for a moment.`,
  t`Roll your shoulders and shake out your arms.`,
  t`Walk across the room and back.`,
];

const playChime = () => {
  try {
    const ctx = new window.AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  } catch {
    // audio isn't essential to the flow
  }
};

function DueDateBadge({ dueDate }: { dueDate: Date | null }) {
  if (!dueDate) return null;

  const overdue = isPast(dueDate) && !isToday(dueDate);

  return (
    <span
      className={
        "ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] " +
        (overdue
          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
          : "bg-light-200 text-light-900 dark:bg-dark-200 dark:text-dark-900")
      }
    >
      {overdue ? (
        <HiOutlineExclamationTriangle className="h-3 w-3" />
      ) : (
        <HiOutlineClock className="h-3 w-3" />
      )}
      {format(dueDate, "d MMM")}
    </span>
  );
}

const STEP_PROGRESS: Partial<Record<Step, number>> = {
  dump: 1,
  review: 2,
  focus: 3,
  micro: 4,
  timer: 5,
};

function ProgressBar({ step }: { step: Step }) {
  const total = 5;
  const current = STEP_PROGRESS[step] ?? 0;
  if (step === "activate" || step === "alreadyDone") return null;

  return (
    <div className="mb-8 flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={
            "h-[3px] flex-1 rounded-full transition-colors " +
            (i < current
              ? "bg-light-1000 dark:bg-dark-1000"
              : "bg-light-300 dark:bg-dark-300")
          }
        />
      ))}
    </div>
  );
}

export default function MorgenstartView() {
  useLingui();
  const { workspace } = useWorkspace();
  const { showPopup } = usePopup();
  const { setLocked } = useFocusLock();
  const router = useRouter();
  const utils = api.useUtils();

  const [step, setStep] = useState<Step>("activate");
  const [dayState, setDayState] = useState<DayState | null>(null);
  const [dumpText, setDumpText] = useState("");
  const [tempNotes, setTempNotes] = useState<string[]>([]);
  const [includedNotes, setIncludedNotes] = useState<Record<number, boolean>>(
    {},
  );
  const [newReviewTask, setNewReviewTask] = useState("");
  const [reviewCreatedTasks, setReviewCreatedTasks] = useState<
    FocusSuggestion[]
  >([]);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<
    string | null
  >(null);
  const [customTaskTitle, setCustomTaskTitle] = useState("");
  const [microstepText, setMicrostepText] = useState("");
  const [targetListPublicId, setTargetListPublicId] = useState<string | null>(
    null,
  );
  const [timerSeconds, setTimerSeconds] = useState(DEFAULT_TIMER_SECONDS);
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_TIMER_SECONDS);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerEndRef = useRef<number | null>(null);

  const impulses = useMemo(() => getImpulses(), []);
  const todayImpulse = useMemo(() => {
    const dayIndex = Math.floor(Date.now() / 86400000);
    return impulses[dayIndex % impulses.length];
  }, [impulses]);

  useEffect(() => {
    if (!workspace.publicId) return;
    const state = loadDayState(workspace.publicId);
    setDayState(state);
    setStep(state.completed ? "alreadyDone" : "activate");

    try {
      const storedList = localStorage.getItem(
        targetListStorageKey(workspace.publicId),
      );
      if (storedList) setTargetListPublicId(storedList);
    } catch {
      // ignore
    }
  }, [workspace.publicId]);

  useEffect(() => {
    setLocked(step !== "alreadyDone");
    return () => setLocked(false);
  }, [step, setLocked]);

  const { data: boards } = api.board.all.useQuery(
    { workspacePublicId: workspace.publicId },
    { enabled: !!workspace.publicId },
  );

  const allLists = useMemo(
    () =>
      (boards ?? []).flatMap((board) =>
        board.lists.map((list) => ({
          publicId: list.publicId,
          boardPublicId: board.publicId,
          name: list.name,
          boardName: board.name,
        })),
      ),
    [boards],
  );

  useEffect(() => {
    if (!targetListPublicId && allLists.length === 1) {
      setTargetListPublicId(allLists[0]?.publicId ?? null);
    }
  }, [allLists, targetListPublicId]);

  const boardPublicIdForList = useCallback(
    (listPublicId: string | null) =>
      (boards ?? []).find((board) =>
        board.lists.some((list) => list.publicId === listPublicId),
      )?.publicId ?? null,
    [boards],
  );

  const todayEnd = useMemo(() => endOfDay(new Date()), []);

  const { data: todaySuggestions } = api.morgenstart.getFocusSuggestions.useQuery(
    { workspacePublicId: workspace.publicId, dueBefore: todayEnd },
    { enabled: !!workspace.publicId && step === "focus" },
  );

  const weekEnd = useMemo(
    () => endOfWeek(new Date(), { weekStartsOn: workspace.weekStartDay }),
    [workspace.weekStartDay],
  );

  const { data: weekSuggestions } = api.morgenstart.getFocusSuggestions.useQuery(
    { workspacePublicId: workspace.publicId, dueBefore: weekEnd },
    { enabled: !!workspace.publicId && step === "nextTask" },
  );

  const createCard = api.card.create.useMutation({
    onError: (error) => {
      showPopup({
        header: t`Something went wrong`,
        message: error.message,
        icon: "error",
      });
    },
  });

  const updateCard = api.card.update.useMutation({
    onError: (error) => {
      showPopup({
        header: t`Something went wrong`,
        message: error.message,
        icon: "error",
      });
    },
  });

  const persist = useCallback(
    (partial: Partial<DayState>) => {
      setDayState((prev) => {
        const next: DayState = {
          completed: false,
          chosenTask: null,
          microstepText: "",
          ...prev,
          ...partial,
        };
        saveDayState(workspace.publicId, next);
        return next;
      });
    },
    [workspace.publicId],
  );

  const rememberTargetList = (listPublicId: string) => {
    setTargetListPublicId(listPublicId);
    try {
      localStorage.setItem(
        targetListStorageKey(workspace.publicId),
        listPublicId,
      );
    } catch {
      // ignore
    }
  };

  const handleDumpSubmit = () => {
    const thoughts = dumpText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!thoughts.length) {
      setStep("focus");
      return;
    }

    setTempNotes(thoughts);
    setIncludedNotes(Object.fromEntries(thoughts.map((_, i) => [i, true])));
    setStep("review");
  };

  const handleReviewSubmit = async () => {
    const titles = [
      ...tempNotes.filter((_, i) => includedNotes[i]),
      ...(newReviewTask.trim() ? [newReviewTask.trim()] : []),
    ];

    if (titles.length && targetListPublicId) {
      const created: FocusSuggestion[] = [];

      for (const title of titles) {
        const newCard = await createCard.mutateAsync({
          title,
          description: "",
          listPublicId: targetListPublicId,
          labelPublicIds: [],
          memberPublicIds: [],
          position: "end",
        });

        const list = allLists.find((l) => l.publicId === targetListPublicId);

        created.push({
          cardPublicId: newCard.publicId,
          title,
          cardNumber: null,
          dueDate: null,
          isActive: false,
          listPublicId: targetListPublicId,
          listName: list?.name ?? "",
          boardPublicId: list?.boardPublicId ?? "",
          boardName: list?.boardName ?? "",
        });
      }

      setReviewCreatedTasks(created);
      await utils.board.invalidate();
    }

    setTempNotes([]);
    setNewReviewTask("");
    setStep("focus");
  };

  const focusCandidates = useMemo(() => {
    const map = new Map<string, FocusSuggestion>();
    for (const candidate of [
      ...reviewCreatedTasks,
      ...(todaySuggestions ?? []),
    ]) {
      map.set(candidate.cardPublicId, candidate);
    }
    return Array.from(map.values());
  }, [reviewCreatedTasks, todaySuggestions]);

  const selectTask = async (candidate: FocusSuggestion) => {
    if (!candidate.isActive) {
      await updateCard.mutateAsync({
        cardPublicId: candidate.cardPublicId,
        isActive: true,
      });
    }
    persist({
      chosenTask: {
        title: candidate.title,
        cardPublicId: candidate.cardPublicId,
        boardPublicId: candidate.boardPublicId,
      },
    });
    await utils.board.invalidate();
    setStep("micro");
  };

  const selectCustomTask = async () => {
    const title = customTaskTitle.trim();
    if (!title) return;

    if (targetListPublicId) {
      const newCard = await createCard.mutateAsync({
        title,
        description: "",
        listPublicId: targetListPublicId,
        labelPublicIds: [],
        memberPublicIds: [],
        position: "start",
      });
      await updateCard.mutateAsync({
        cardPublicId: newCard.publicId,
        isActive: true,
      });
      persist({
        chosenTask: {
          title,
          cardPublicId: newCard.publicId,
          boardPublicId: boardPublicIdForList(targetListPublicId),
        },
      });
      await utils.board.invalidate();
    } else {
      persist({ chosenTask: { title, cardPublicId: null, boardPublicId: null } });
    }

    setStep("micro");
  };

  const startTimer = (seconds: number) => {
    setTimerSeconds(seconds);
    setSecondsLeft(seconds);
    timerEndRef.current = Date.now() + seconds * 1000;
    setTimerRunning(true);
    setStep("timer");
  };

  useEffect(() => {
    if (!timerRunning) return;

    const interval = setInterval(() => {
      const end = timerEndRef.current;
      if (!end) return;

      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setSecondsLeft(left);

      if (left <= 0) {
        setTimerRunning(false);
        playChime();
        setStep("afterTimer");
      }
    }, 250);

    return () => clearInterval(interval);
  }, [timerRunning]);

  const openBoard = () => {
    const boardPublicId = dayState?.chosenTask?.boardPublicId;
    persist({ completed: true });
    setLocked(false);
    if (boardPublicId) {
      void router.push(
        `/boards/${boardPublicId}?view=due-date&expand=today&expand=active`,
      );
    } else {
      void router.push("/boards");
    }
  };

  if (!dayState) return null;

  const targetListSelect = (
    <select
      className="mb-3 w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000"
      value={targetListPublicId ?? ""}
      onChange={(e) => rememberTargetList(e.target.value)}
    >
      <option value="" disabled>
        {t`Choose where new cards should go`}
      </option>
      {allLists.map((list) => (
        <option key={list.publicId} value={list.publicId}>
          {list.boardName} / {list.name}
        </option>
      ))}
    </select>
  );

  const circumference = 2 * Math.PI * 90;
  const progress = 1 - secondsLeft / timerSeconds;

  return (
    <>
      <PageHead title={t`Morgenstart | ${workspace.name}`} />
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-[520px]">
          <ProgressBar step={step} />

          {step === "activate" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`Good morning.`}
              </h1>
              <p className="mb-7 text-lg text-light-900 dark:text-dark-900">
                {todayImpulse}
              </p>
              <Button size="lg" onClick={() => setStep("dump")}>
                {t`Done`}
              </Button>
            </div>
          )}

          {step === "dump" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`What's on your mind right now?`}
              </h1>
              <p className="mb-4 text-light-900 dark:text-dark-900">
                {t`One thought per line. You don't need to decide anything here yet - just get it out of your head.`}
              </p>
              <textarea
                autoFocus
                className="mb-3 min-h-[150px] w-full resize-y rounded-md border border-light-400 bg-light-50 p-3.5 text-[1.05rem] leading-relaxed dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000"
                placeholder={t`Email Anna\nCheck invoice\n...`}
                value={dumpText}
                onChange={(e) => setDumpText(e.target.value)}
              />
              <Button size="lg" onClick={handleDumpSubmit}>
                {dumpText.trim() ? t`Continue` : t`My head is clear`}
              </Button>
            </div>
          )}

          {step === "review" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`Take another look.`}
              </h1>
              <p className="mb-4 text-light-900 dark:text-dark-900">
                {t`Which of these should actually become a task? Uncheck anything that doesn't belong here.`}
              </p>
              {allLists.length > 1 && targetListSelect}
              <ul className="mb-3 divide-y divide-light-300 dark:divide-dark-300">
                {tempNotes.map((note, i) => (
                  <li key={i} className="flex items-center gap-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-light-1000 dark:accent-dark-1000"
                      checked={!!includedNotes[i]}
                      onChange={(e) =>
                        setIncludedNotes((prev) => ({
                          ...prev,
                          [i]: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-[1.05rem] text-neutral-900 dark:text-dark-1000">
                      {note}
                    </span>
                  </li>
                ))}
              </ul>
              <input
                type="text"
                className="mb-3 w-full rounded-md border border-light-400 bg-light-50 px-3.5 py-3 text-[1.05rem] dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000"
                placeholder={t`Add another task`}
                value={newReviewTask}
                onChange={(e) => setNewReviewTask(e.target.value)}
              />
              <Button
                size="lg"
                isLoading={createCard.isPending}
                disabled={
                  (Object.values(includedNotes).some(Boolean) ||
                    newReviewTask.trim().length > 0) &&
                  allLists.length > 0 &&
                  !targetListPublicId
                }
                onClick={handleReviewSubmit}
              >
                {t`Take on as tasks`}
              </Button>
            </div>
          )}

          {step === "focus" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`What matters most today?`}
              </h1>
              <p className="mb-4 text-light-900 dark:text-dark-900">
                {t`Pick one task to work on now.`}
              </p>
              {!!focusCandidates.length && (
                <ul className="mb-4 divide-y divide-light-300 dark:divide-dark-300">
                  {focusCandidates.map((candidate) => (
                    <li key={candidate.cardPublicId}>
                      <button
                        type="button"
                        className={
                          "flex w-full items-center gap-3 py-2.5 text-left " +
                          (selectedCandidateKey === candidate.cardPublicId
                            ? "text-light-1000 dark:text-dark-1000"
                            : "text-neutral-900 dark:text-dark-1000")
                        }
                        onClick={() => {
                          setSelectedCandidateKey(candidate.cardPublicId);
                          void selectTask(candidate);
                        }}
                      >
                        <span
                          className={
                            "h-4 w-4 flex-shrink-0 rounded-full border-2 " +
                            (selectedCandidateKey === candidate.cardPublicId
                              ? "border-light-1000 bg-light-1000 dark:border-dark-1000 dark:bg-dark-1000"
                              : "border-light-600 dark:border-dark-600")
                          }
                        />
                        <span className="text-[1.05rem]">
                          {candidate.title}
                        </span>
                        <DueDateBadge dueDate={candidate.dueDate} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mb-2 text-sm text-light-900 dark:text-dark-900">
                {t`Or something else:`}
              </p>
              {allLists.length > 1 &&
                !targetListPublicId &&
                customTaskTitle.trim().length > 0 &&
                targetListSelect}
              <div className="flex gap-2">
                <input
                  type="text"
                  className="w-full rounded-md border border-light-400 bg-light-50 px-3.5 py-3 text-[1.05rem] dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000"
                  placeholder={t`The one thing for today`}
                  value={customTaskTitle}
                  onChange={(e) => setCustomTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !(allLists.length > 1 && !targetListPublicId)
                    )
                      void selectCustomTask();
                  }}
                />
                <Button
                  size="lg"
                  isLoading={createCard.isPending || updateCard.isPending}
                  disabled={
                    !customTaskTitle.trim() ||
                    (allLists.length > 1 && !targetListPublicId)
                  }
                  onClick={() => void selectCustomTask()}
                >
                  {t`Set it`}
                </Button>
              </div>
            </div>
          )}

          {step === "micro" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {dayState.chosenTask?.title ?? t`Your task`}
              </h1>
              <p className="mb-4 text-light-900 dark:text-dark-900">
                {t`What is the very first small step? Something you can finish in two minutes.`}
              </p>
              {(() => {
                const last = dayState.chosenTask
                  ? lastMicrostepFor(workspace.publicId, dayState.chosenTask.title)
                  : null;
                return last ? (
                  <button
                    type="button"
                    className="mb-3 inline-flex items-center rounded-full border border-dashed border-light-600 px-3 py-1.5 text-sm text-neutral-900 hover:bg-light-200 dark:border-dark-600 dark:text-dark-1000 dark:hover:bg-dark-200"
                    onClick={() => setMicrostepText(last)}
                  >
                    {t`Last time:`} {last}
                  </button>
                ) : null;
              })()}
              <input
                type="text"
                autoFocus
                className="mb-3 w-full rounded-md border border-light-400 bg-light-50 px-3.5 py-3 text-[1.05rem] dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000"
                placeholder={t`e.g. open the file and read the first line`}
                value={microstepText}
                onChange={(e) => setMicrostepText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && microstepText.trim()) {
                    persist({ microstepText });
                    startTimer(DEFAULT_TIMER_SECONDS);
                  }
                }}
              />
              <Button
                size="lg"
                disabled={!microstepText.trim()}
                onClick={() => {
                  persist({ microstepText });
                  startTimer(DEFAULT_TIMER_SECONDS);
                }}
              >
                {t`I'll do that`}
              </Button>
            </div>
          )}

          {step === "timer" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {microstepText}
              </h1>
              <p className="mb-6 text-light-900 dark:text-dark-900">
                {t`Just a few minutes. After that you can decide how to continue.`}
              </p>
              <div className="mb-6 flex justify-center">
                <div className="relative grid place-items-center">
                  <svg
                    viewBox="0 0 200 200"
                    className="h-[min(280px,70vw)] w-[min(280px,70vw)] -rotate-90"
                  >
                    <circle
                      cx="100"
                      cy="100"
                      r="90"
                      fill="none"
                      strokeWidth="6"
                      className="stroke-light-300 dark:stroke-dark-300"
                    />
                    <circle
                      cx="100"
                      cy="100"
                      r="90"
                      fill="none"
                      strokeWidth="6"
                      strokeLinecap="round"
                      className="stroke-light-1000 transition-[stroke-dashoffset] duration-1000 ease-linear dark:stroke-dark-1000"
                      strokeDasharray={circumference}
                      strokeDashoffset={circumference * (1 - progress)}
                    />
                  </svg>
                  <div className="absolute text-5xl font-light tabular-nums text-neutral-900 dark:text-dark-1000">
                    {Math.floor(secondsLeft / 60)}:
                    {String(secondsLeft % 60).padStart(2, "0")}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === "afterTimer" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`Time's up.`}
              </h1>
              <p className="mb-5 text-light-900 dark:text-dark-900">
                {t`How much longer do you want to keep working on it?`}
              </p>
              <div className="mb-6 flex flex-wrap gap-2">
                {EXTEND_OPTIONS_MIN.map((minutes) => (
                  <Button
                    key={minutes}
                    variant="secondary"
                    onClick={() => startTimer(minutes * 60)}
                  >
                    {minutes} {t`min`}
                  </Button>
                ))}
              </div>
              <p className="mb-3 text-sm text-light-900 dark:text-dark-900">
                {t`Or, without setting a timer:`}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" onClick={() => setStep("nextTask")}>
                  {t`Choose another task`}
                </Button>
                <button
                  type="button"
                  className="text-sm text-light-900 underline underline-offset-2 dark:text-dark-900"
                  onClick={openBoard}
                >
                  {t`Open board`}
                </button>
              </div>
            </div>
          )}

          {step === "nextTask" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`What's next?`}
              </h1>
              <p className="mb-4 text-light-900 dark:text-dark-900">
                {t`Tasks planned for today, or this week as a fallback.`}
              </p>
              {!!weekSuggestions?.length && (
                <ul className="mb-4 divide-y divide-light-300 dark:divide-dark-300">
                  {weekSuggestions
                    .filter(
                      (candidate) =>
                        candidate.cardPublicId !==
                        dayState.chosenTask?.cardPublicId,
                    )
                    .map((candidate) => (
                      <li key={candidate.cardPublicId}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 py-2.5 text-left text-neutral-900 dark:text-dark-1000"
                          onClick={() => void selectTask(candidate)}
                        >
                          <span className="text-[1.05rem]">
                            {candidate.title}
                          </span>
                          <DueDateBadge dueDate={candidate.dueDate} />
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              <button
                type="button"
                className="text-sm text-light-900 underline underline-offset-2 dark:text-dark-900"
                onClick={openBoard}
              >
                {t`Skip - open board instead`}
              </button>
            </div>
          )}

          {step === "alreadyDone" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`Already started today.`}
              </h1>
              {dayState.chosenTask && (
                <p className="mb-7 text-[1.05rem] text-neutral-900 dark:text-dark-1000">
                  {t`Your focus today:`} {dayState.chosenTask.title}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" href="/boards">
                  {t`Close`}
                </Button>
                <button
                  type="button"
                  className="text-sm text-light-900 underline underline-offset-2 dark:text-dark-900"
                  onClick={() => setStep("activate")}
                >
                  {t`Go through it again`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
