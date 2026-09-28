import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { format, isPast, isToday } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HiOutlineCheck,
  HiOutlineClock,
  HiOutlineExclamationTriangle,
} from "react-icons/hi2";

import Button from "~/components/Button";
import { PageHead } from "~/components/PageHead";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import type { RouterOutputs } from "~/utils/api";
import { api } from "~/utils/api";

type FocusSuggestion = RouterOutputs["morgenstart"]["getFocusSuggestions"][number];

type Step =
  | "activate"
  | "dump"
  | "focus"
  | "micro"
  | "timer"
  | "done"
  | "alreadyDone";

interface FocusTask {
  title: string;
  cardPublicId: string | null;
}

interface DayState {
  completed: boolean;
  focusTasks: FocusTask[];
  microstepText: string;
}

const TIMER_SECONDS = 5 * 60;

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
  return { completed: false, focusTasks: [], microstepText: "" };
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

function ProgressBar({ step }: { step: number; total: number }) {
  const total = 5;
  return (
    <div className="mb-8 flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={
            "h-[3px] flex-1 rounded-full transition-colors " +
            (i < step
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
  const utils = api.useUtils();

  const [step, setStep] = useState<Step>("activate");
  const [dayState, setDayState] = useState<DayState | null>(null);
  const [dumpText, setDumpText] = useState("");
  const [focusInputs, setFocusInputs] = useState<string[]>([""]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<
    Record<string, FocusSuggestion>
  >({});
  const [microstepText, setMicrostepText] = useState("");
  const [targetListPublicId, setTargetListPublicId] = useState<string | null>(
    null,
  );
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SECONDS);
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

  const { data: boards } = api.board.all.useQuery(
    { workspacePublicId: workspace.publicId },
    { enabled: !!workspace.publicId },
  );

  const allLists = useMemo(
    () =>
      (boards ?? []).flatMap((board) =>
        board.lists.map((list) => ({
          publicId: list.publicId,
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

  const { data: suggestions } = api.morgenstart.getFocusSuggestions.useQuery(
    { workspacePublicId: workspace.publicId },
    { enabled: !!workspace.publicId && step === "focus" },
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
          focusTasks: [],
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

  const handleDumpSubmit = async () => {
    const thoughts = dumpText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (thoughts.length && targetListPublicId) {
      for (const title of thoughts) {
        await createCard.mutateAsync({
          title,
          description: "",
          listPublicId: targetListPublicId,
          labelPublicIds: [],
          memberPublicIds: [],
          position: "end",
        });
      }
      await utils.board.invalidate();
    }

    setStep("focus");
  };

  const handleFocusSubmit = async () => {
    const titles = focusInputs.map((title) => title.trim()).filter(Boolean);

    if (!titles.length) return;

    const tasks: FocusTask[] = [];

    for (const title of titles) {
      const suggestion = selectedSuggestions[title];

      if (suggestion) {
        if (!suggestion.isActive) {
          await updateCard.mutateAsync({
            cardPublicId: suggestion.cardPublicId,
            isActive: true,
          });
        }
        tasks.push({ title, cardPublicId: suggestion.cardPublicId });
      } else if (targetListPublicId) {
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
        tasks.push({ title, cardPublicId: newCard.publicId });
      } else {
        tasks.push({ title, cardPublicId: null });
      }
    }

    await utils.board.invalidate();
    persist({ focusTasks: tasks });
    setStep("micro");
  };

  const startTimer = () => {
    timerEndRef.current = Date.now() + TIMER_SECONDS * 1000;
    setTimerRunning(true);
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
        persist({ completed: true, microstepText });
        setStep("done");
      }
    }, 250);

    return () => clearInterval(interval);
  }, [timerRunning, microstepText, persist]);

  if (!dayState) return null;

  const circumference = 2 * Math.PI * 90;
  const progress = 1 - secondsLeft / TIMER_SECONDS;

  return (
    <>
      <PageHead title={t`Morgenstart | ${workspace.name}`} />
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-[520px]">
          {step !== "activate" && step !== "alreadyDone" && (
            <ProgressBar
              step={
                (
                  {
                    dump: 1,
                    focus: 2,
                    micro: 3,
                    timer: 4,
                    done: 5,
                  } as Partial<Record<Step, number>>
                )[step] ?? 0
              }
              total={5}
            />
          )}

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
                {t`One thought per line. You don't need to decide anything here - each line becomes a card so you don't lose it.`}
              </p>
              {allLists.length > 1 && (
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
              )}
              <textarea
                className="mb-3 min-h-[150px] w-full resize-y rounded-md border border-light-400 bg-light-50 p-3.5 text-[1.05rem] leading-relaxed dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000"
                placeholder={t`Email Anna\nCheck invoice\n...`}
                value={dumpText}
                onChange={(e) => setDumpText(e.target.value)}
              />
              <Button
                size="lg"
                isLoading={createCard.isPending}
                disabled={
                  dumpText.trim().length > 0 &&
                  allLists.length > 0 &&
                  !targetListPublicId
                }
                onClick={handleDumpSubmit}
              >
                {dumpText.trim() ? t`Park it` : t`My head is clear`}
              </Button>
            </div>
          )}

          {step === "focus" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`What matters most today?`}
              </h1>
              <p className="mb-4 text-light-900 dark:text-dark-900">
                {t`One task is enough. Three at most.`}
              </p>
              {!!suggestions?.length && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.cardPublicId}
                      type="button"
                      className="inline-flex items-center rounded-full border border-dashed border-light-600 px-3 py-1.5 text-sm text-neutral-900 hover:bg-light-200 dark:border-dark-600 dark:text-dark-1000 dark:hover:bg-dark-200"
                      onClick={() => {
                        setFocusInputs((prev) => {
                          const emptyIndex = prev.findIndex(
                            (v) => !v.trim(),
                          );
                          if (emptyIndex >= 0) {
                            const next = [...prev];
                            next[emptyIndex] = suggestion.title;
                            return next;
                          }
                          if (prev.length >= 3) return prev;
                          return [...prev, suggestion.title];
                        });
                        setSelectedSuggestions((prev) => ({
                          ...prev,
                          [suggestion.title]: suggestion,
                        }));
                      }}
                    >
                      {suggestion.title}
                      <DueDateBadge dueDate={suggestion.dueDate} />
                    </button>
                  ))}
                </div>
              )}
              <div className="mb-3 flex flex-col gap-2">
                {focusInputs.map((value, i) => (
                  <input
                    key={i}
                    type="text"
                    className="w-full rounded-md border border-light-400 bg-light-50 px-3.5 py-3 text-[1.05rem] dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000"
                    placeholder={
                      i === 0 ? t`The one thing for today` : t`Optional`
                    }
                    value={value}
                    onChange={(e) => {
                      const next = [...focusInputs];
                      next[i] = e.target.value;
                      setFocusInputs(next);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleFocusSubmit();
                    }}
                  />
                ))}
              </div>
              {focusInputs.length < 3 && (
                <button
                  type="button"
                  className="mb-2 text-sm text-light-900 underline underline-offset-2 dark:text-dark-900"
                  onClick={() => setFocusInputs((prev) => [...prev, ""])}
                >
                  {t`Add another task`}
                </button>
              )}
              <div className="mt-2">
                <Button
                  size="lg"
                  isLoading={createCard.isPending || updateCard.isPending}
                  onClick={handleFocusSubmit}
                >
                  {t`Set it`}
                </Button>
              </div>
            </div>
          )}

          {step === "micro" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {dayState.focusTasks[0]?.title ?? t`Your task`}
              </h1>
              <p className="mb-4 text-light-900 dark:text-dark-900">
                {t`What is the very first small step? Something you can finish in two minutes.`}
              </p>
              <input
                type="text"
                autoFocus
                className="mb-3 w-full rounded-md border border-light-400 bg-light-50 px-3.5 py-3 text-[1.05rem] dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000"
                placeholder={t`e.g. open the file and read the first line`}
                value={microstepText}
                onChange={(e) => setMicrostepText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && microstepText.trim()) {
                    setStep("timer");
                  }
                }}
              />
              <Button
                size="lg"
                disabled={!microstepText.trim()}
                onClick={() => setStep("timer")}
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
                {t`Just five minutes. After that you're allowed to stop.`}
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
              {!timerRunning && (
                <div className="flex justify-center">
                  <Button size="lg" onClick={startTimer}>
                    {t`Start`}
                  </Button>
                </div>
              )}
            </div>
          )}

          {step === "done" && (
            <div>
              <HiOutlineCheck className="mb-5 h-16 w-16 text-light-1000 dark:text-dark-1000" />
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`You're in.`}
              </h1>
              <p className="mb-7 text-light-900 dark:text-dark-900">
                {t`Just keep going while it's flowing.`}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" href="/boards">
                  {t`Keep working`}
                </Button>
                <button
                  type="button"
                  className="text-sm text-light-900 underline underline-offset-2 dark:text-dark-900"
                  onClick={() => {
                    setSecondsLeft(TIMER_SECONDS);
                    setStep("timer");
                  }}
                >
                  {t`Five more minutes`}
                </button>
              </div>
            </div>
          )}

          {step === "alreadyDone" && (
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-dark-1000">
                {t`Already started today.`}
              </h1>
              <p className="mb-4 text-light-900 dark:text-dark-900">
                {t`Your focus for today:`}
              </p>
              <ul className="mb-7 divide-y divide-light-300 dark:divide-dark-300">
                {dayState.focusTasks.map((task, i) => (
                  <li key={i} className="py-2.5 text-[1.05rem]">
                    {task.cardPublicId ? (
                      <a
                        href={`/cards/${task.cardPublicId}`}
                        className="text-neutral-900 hover:underline dark:text-dark-1000"
                      >
                        {task.title}
                      </a>
                    ) : (
                      <span className="text-neutral-900 dark:text-dark-1000">
                        {task.title}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
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
