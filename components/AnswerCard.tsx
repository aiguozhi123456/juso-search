import type { NormalizedAnswer } from '@/lib/providers/types';
import { t, MSG } from '@/lib/i18n';

export function AnswerCard({ answer }: { answer: NormalizedAnswer }) {
  return (
    <section className="answer-card">
      <h3>{t(MSG.answer_heading)}</h3>
      <p className="answer-text">{answer.text}</p>
      {answer.citations.length > 0 && (
        <ul className="citations">
          {answer.citations.map((c, i) => (
            <li key={`${c.url}-${i}`}>
              <a href={c.url} target="_blank" rel="noreferrer">
                {c.title ?? c.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
