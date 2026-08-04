import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';

const params = generatorParameters({ request_retention: 0.9, maximum_interval: 365 });
const scheduler = fsrs(params);

export function createCard(): Card {
  return createEmptyCard();
}

export function scheduleReview(card: Card, rating: Grade) {
  const now = new Date();
  const result = scheduler.next(card, now, rating);
  return {
    card: result.card,
    due_at: result.card.due.getTime(),
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    elapsed_days: result.card.elapsed_days,
    scheduled_days: result.card.scheduled_days,
    reps: result.card.reps,
    lapses: result.card.lapses,
    state: result.card.state.valueOf() as number,
  };
}

export function deserializeCard(data: {
  due_at: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
}): Card {
  const card = createEmptyCard();
  card.due = new Date(data.due_at);
  card.stability = data.stability;
  card.difficulty = data.difficulty;
  card.elapsed_days = data.elapsed_days;
  card.scheduled_days = data.scheduled_days;
  card.reps = data.reps;
  card.lapses = data.lapses;
  card.state = data.state as unknown as Card['state'];
  return card;
}

export type ReviewRating = 1 | 2 | 3 | 4;

export const RATINGS: { value: ReviewRating; grade: Grade; labelKey: string; key: string }[] = [
  { value: 1, grade: Rating.Again, labelKey: 'ratings.again', key: 'Again' },
  { value: 2, grade: Rating.Hard, labelKey: 'ratings.hard', key: 'Hard' },
  { value: 3, grade: Rating.Good, labelKey: 'ratings.good', key: 'Good' },
  { value: 4, grade: Rating.Easy, labelKey: 'ratings.easy', key: 'Easy' },
];

export { Rating, State };
