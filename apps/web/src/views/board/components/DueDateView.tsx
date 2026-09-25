import type { DragEndEvent } from "@dnd-kit/core";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { t } from "@lingui/core/macro";
import {
  addDays,
  endOfDay,
  endOfWeek,
  startOfDay,
} from "date-fns";
import { useEffect, useMemo, useState } from "react";
import {
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineExclamationTriangle,
  HiOutlineFire,
  HiOutlineInbox,
  HiOutlineSun,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { BoardCard, BoardList } from "../types";
import { isPlaceholderPublicId } from "~/utils/helpers";
import Card from "./Card";

export type DueDateBucketKey =
  | "none"
  | "future"
  | "week"
  | "today"
  | "active"
  | "overdue";

const BUCKET_ORDER: DueDateBucketKey[] = [
  "none",
  "future",
  "week",
  "today",
  "active",
  "overdue",
];

export const getDueDateBucketUpdate = (
  bucket: DueDateBucketKey,
  weekStartsOn: 0 | 1 | 6,
): { dueDate?: Date | null; isActive: boolean } => {
  const today = startOfDay(new Date());

  switch (bucket) {
    case "active":
      return { isActive: true };
    case "none":
      return { dueDate: null, isActive: false };
    case "overdue":
      return { dueDate: addDays(today, -1), isActive: false };
    case "today":
      return { dueDate: today, isActive: false };
    case "week": {
      const weekEnd = startOfDay(endOfWeek(today, { weekStartsOn }));
      const target = weekEnd.getTime() <= today.getTime()
        ? addDays(today, 1)
        : weekEnd;
      return { dueDate: target, isActive: false };
    }
    case "future": {
      const weekEnd = startOfDay(endOfWeek(today, { weekStartsOn }));
      return { dueDate: addDays(weekEnd, 1), isActive: false };
    }
  }
};

const classifyCard = (
  card: { dueDate: Date | null; isActive: boolean },
  weekStartsOn: 0 | 1 | 6,
): DueDateBucketKey => {
  if (card.isActive) return "active";
  if (!card.dueDate) return "none";

  const now = new Date();
  const today = startOfDay(now);
  const endOfToday = endOfDay(now);

  if (card.dueDate < today) return "overdue";
  if (card.dueDate <= endOfToday) return "today";

  const weekEnd = endOfDay(endOfWeek(now, { weekStartsOn }));
  if (card.dueDate <= weekEnd) return "week";

  return "future";
};

interface DraggableDueDateCardProps {
  card: BoardCard;
  cardPrefix: string;
  href: string;
  disabled: boolean;
}

function DraggableDueDateCard({
  card,
  cardPrefix,
  href,
  disabled,
}: DraggableDueDateCardProps) {
  const isPlaceholder = isPlaceholderPublicId(card.publicId);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: card.publicId,
      disabled: disabled || isPlaceholder,
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
  };

  return (
    <Link
      href={href}
      onClick={(e) => {
        if (isPlaceholder) e.preventDefault();
      }}
      className={twMerge(
        "mb-2 flex flex-col",
        isPlaceholder ? "pointer-events-none" : "",
        !disabled && isDragging ? "cursor-grabbing" : "cursor-pointer",
      )}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <Card
        title={card.title}
        ticketNumber={
          card.cardNumber != null ? `${cardPrefix}-${card.cardNumber}` : null
        }
        labels={card.labels}
        project={card.project}
        members={card.members}
        checklists={card.checklists ?? []}
        description={card.description ?? null}
        comments={card.comments ?? []}
        attachments={card.attachments}
        dueDate={card.dueDate ?? null}
      />
    </Link>
  );
}

interface DueDateColumnProps {
  bucket: DueDateBucketKey;
  cards: BoardCard[];
  cardPrefix: string;
  getCardHref: (cardPublicId: string) => string;
  canEditCard: boolean;
}

const BUCKET_ICONS: Record<DueDateBucketKey, React.ReactNode> = {
  none: <HiOutlineInbox className="h-4 w-4" />,
  future: <HiOutlineCalendarDays className="h-4 w-4" />,
  week: <HiOutlineClock className="h-4 w-4" />,
  today: <HiOutlineSun className="h-4 w-4" />,
  active: <HiOutlineFire className="h-4 w-4" />,
  overdue: <HiOutlineExclamationTriangle className="h-4 w-4" />,
};

const getBucketLabels = (): Record<DueDateBucketKey, string> => ({
  none: t`No due date`,
  future: t`Future`,
  week: t`This week`,
  today: t`Today`,
  active: t`Active`,
  overdue: t`Overdue`,
});

function DueDateColumn({
  bucket,
  cards,
  cardPrefix,
  getCardHref,
  canEditCard,
}: DueDateColumnProps) {
  const bucketLabels = getBucketLabels();
  const { setNodeRef, isOver } = useDroppable({ id: bucket });

  return (
    <div className="mr-5 h-fit min-w-[18rem] max-w-[18rem] snap-start rounded-md border border-light-400 bg-light-300 py-2 pl-2 pr-1 dark:border-dark-300 dark:bg-dark-100 md:snap-align-none">
      <div className="mb-2 flex items-center justify-between px-2 pt-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-dark-1000">
          <span className="text-dark-900">{BUCKET_ICONS[bucket]}</span>
          {bucketLabels[bucket]}
        </div>
        <span className="text-xs text-light-800 dark:text-dark-800">
          {cards.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={twMerge(
          "scrollbar-track-rounded-[4px] scrollbar-thumb-rounded-[4px] scrollbar-w-[8px] max-h-[calc(100dvh-225px)] min-h-[4rem] overflow-y-auto overflow-x-hidden rounded-[4px] pb-2 pr-1 scrollbar dark:scrollbar-track-dark-100 dark:scrollbar-thumb-dark-600",
          isOver && "bg-light-400 dark:bg-dark-200",
        )}
      >
        {cards.map((card) => (
          <DraggableDueDateCard
            key={card.publicId}
            card={card}
            cardPrefix={cardPrefix}
            href={getCardHref(card.publicId)}
            disabled={!canEditCard}
          />
        ))}
      </div>
    </div>
  );
}

interface DueDateViewProps {
  lists: BoardList[];
  cardPrefix: string;
  weekStartsOn: 0 | 1 | 6;
  canEditCard: boolean;
  getCardHref: (cardPublicId: string) => string;
  onCardMove: (
    cardPublicId: string,
    bucket: DueDateBucketKey,
    onSettled: () => void,
  ) => void;
}

const DueDateView = ({
  lists,
  cardPrefix,
  weekStartsOn,
  canEditCard,
  getCardHref,
  onCardMove,
}: DueDateViewProps) => {
  const [pendingMove, setPendingMove] = useState<{
    cardPublicId: string;
    bucket: DueDateBucketKey;
  } | null>(null);

  const allCards = useMemo(
    () => lists.flatMap((list) => list.cards),
    [lists],
  );

  const cardsByBucket = useMemo(() => {
    const map = new Map<DueDateBucketKey, BoardCard[]>();
    for (const bucket of BUCKET_ORDER) map.set(bucket, []);

    for (const card of allCards) {
      const bucket =
        pendingMove?.cardPublicId === card.publicId
          ? pendingMove.bucket
          : classifyCard(card, weekStartsOn);
      map.get(bucket)?.push(card);
    }

    return map;
  }, [allCards, pendingMove, weekStartsOn]);

  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (activeId == null) return;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = "";
    };
  }, [activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const activeCard = useMemo(
    () => allCards.find((card) => card.publicId === activeId) ?? null,
    [activeId, allCards],
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || !canEditCard) return;

    const cardPublicId = String(active.id);
    const card = allCards.find((c) => c.publicId === cardPublicId);
    if (!card) return;

    const sourceBucket = classifyCard(card, weekStartsOn);
    const targetBucket = over.id as DueDateBucketKey;
    if (sourceBucket === targetBucket) return;

    setPendingMove({ cardPublicId, bucket: targetBucket });
    onCardMove(cardPublicId, targetBucket, () => setPendingMove(null));
  };

  return (
    <div className="z-0 flex min-h-0 flex-1 overflow-x-auto">
      <DndContext
        sensors={sensors}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex w-max px-[10px] md:px-[2rem]">
          {BUCKET_ORDER.map((bucket) => (
            <DueDateColumn
              key={bucket}
              bucket={bucket}
              cards={cardsByBucket.get(bucket) ?? []}
              cardPrefix={cardPrefix}
              getCardHref={getCardHref}
              canEditCard={canEditCard}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCard ? (
            <div style={{ width: "18rem" }}>
              <Card
                title={activeCard.title}
                ticketNumber={
                  activeCard.cardNumber != null
                    ? `${cardPrefix}-${activeCard.cardNumber}`
                    : null
                }
                labels={activeCard.labels}
                project={activeCard.project}
                members={activeCard.members}
                checklists={activeCard.checklists ?? []}
                description={activeCard.description ?? null}
                comments={activeCard.comments ?? []}
                attachments={activeCard.attachments}
                dueDate={activeCard.dueDate ?? null}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default DueDateView;
