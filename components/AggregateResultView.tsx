import { useState } from 'react';
import type { AggregateMemberId, AggregateSearchResponse } from '@/lib/aggregate/types';
import { resolveIconUrl } from '@/lib/sources';
import { ResultList } from './ResultList';
import { relativeTime } from './relativeTime';
import { t, MSG } from '@/lib/i18n';

/** 账单提示阈值（plan Phase 4）：有效成员 ≥ 此数时，「强制全新搜索」先弹两步确认
 *  （沿仓库两步确认先例，如 AggregateSearchManager 的删除确认）；1–3 成员直接执行。 */
const FORCE_REFRESH_CONFIRM_THRESHOLD = 4;

/** 成员徽标（favicon + label）：由宿主（App.tsx）解析注入——provider 实例成员显示实例名 + base
 *  provider favicon，engine 成员显示 engine 标签，裸 provider 成员显示 provider 标签。 */
export type { ResultSourceBadge as AggregateMemberBadge } from './ResultList';

interface Props {
  response: AggregateSearchResponse;
  /** 视图标题 = 实例名（R13；App 从快照解析，未知实例回退实例 id）。 */
  instanceName: string;
  /** 该实例的有效成员数（KTD5 eligibility.validMembers；宿主从快照解析，实例已删时回退
   *  response.members.length）。账单确认阈值判定输入。 */
  validMemberCount: number;
  /** 聚合级缓存整条命中（AE7）：meta 条上方显示命中时间。 */
  cacheHit: boolean;
  cacheCreatedAt?: number;
  /** 强制刷新失败文案（沿用 solo refreshError 语义，不整页报错）。 */
  refreshError?: string | null;
  onForceRefresh: () => void;
  getMemberBadge: (member: AggregateMemberId) => { id: string; label: string; favicon?: string };
}

/**
 * 聚合搜索视图（R4/R5/R13）：视图标题（实例名）→ 常驻 meta 条（`N 源 · M 成功（K 缓存）/ X 失败 ·
 * 去重 D 条 · 重排 top Y` + [强制全新搜索] + 明细可展开；用户反馈调整：meta 条在成员 AI 回答区
 * 上方，沿常规搜索引擎统计条在上的惯例）→ 成员回答区（每条带来源徽标，成员序全展示）→
 * ResultList（per-result 多源徽标 + score 百分比）。沿 AnswerCard/ResultCard 既有视觉语言
 * （.answer-card / .cache-notice 同族样式），不新建设计体系。
 */
export function AggregateResultView({ response, instanceName, validMemberCount, cacheHit, cacheCreatedAt, refreshError, onForceRefresh, getMemberBadge }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  // 状态卫生：response 换代（新搜索 / AE7 历史回放换实例）时收回未决的确认，
  // 避免上一实例的确认被误用于新响应（detailsOpen 是用户偏好，保持不重置）。
  // 渲染期调整自身 state（React 官方 "adjusting state when a prop changes"），
  // 语义与原 [response] effect 恒等：prop 换代当帧即收回，不等待 commit。
  const [prevResponse, setPrevResponse] = useState(response);
  if (response !== prevResponse) {
    setPrevResponse(response);
    setConfirmRefresh(false);
  }
  const okMembers = response.members.filter((member) => member.ok);
  const cachedCount = okMembers.filter((member) => member.cached).length;
  const failedCount = response.members.length - okMembers.length;

  // R13 meta 条分段：`N 源 · M 成功（K 缓存）/ X 失败 · 去重 D 条 · 重排 top Y`。
  const segments: string[] = [t(MSG.aggregate_meta_sources, [String(response.members.length)])];
  if (okMembers.length > 0) {
    segments.push(cachedCount > 0
      ? t(MSG.aggregate_meta_ok_cached, [String(okMembers.length), String(cachedCount)])
      : t(MSG.aggregate_meta_ok, [String(okMembers.length)]));
  }
  if (failedCount > 0) segments.push(t(MSG.aggregate_meta_failed, [String(failedCount)]));
  segments.push(t(MSG.aggregate_meta_deduped, [String(response.dedupedCount ?? 0)]));
  segments.push(t(MSG.aggregate_meta_top, [String(response.results.length)]));

  function handleForceRefreshClick() {
    // 账单提示（plan Phase 4）：有效成员 ≥ 4 → 两步确认「将重新查询 N 个成员」；1–3 直接执行。
    if (validMemberCount >= FORCE_REFRESH_CONFIRM_THRESHOLD) {
      setConfirmRefresh(true);
      return;
    }
    onForceRefresh();
  }

  return (
    <section className="aggregate-view" data-instance={response.instanceId}>
      <h2 className="aggregate-view-title">{instanceName}</h2>
      {cacheHit && (
        <div className="cache-notice" data-testid="aggregate-cache-hit">
          <span>{t(MSG.aggregate_cache_hit_notice, [cacheCreatedAt ? relativeTime(cacheCreatedAt) : ''])}</span>
        </div>
      )}
      <div className="aggregate-meta">
        <span className="aggregate-meta-summary">{segments.join(' · ')}</span>
        {confirmRefresh ? (
          // 两步确认（账单提示，plan Phase 4）：确认/取消，沿实例删除确认的既有交互先例。
          // 元素直接平铺在 .aggregate-meta flex 容器里（沿用既有 gap/按钮样式，无新 CSS）。
          <>
            <span role="alert">{t(MSG.aggregate_force_refresh_confirm, [String(validMemberCount)])}</span>
            <button
              type="button"
              className="aggregate-meta-refresh"
              onClick={() => {
                setConfirmRefresh(false);
                onForceRefresh();
              }}
            >
              {t(MSG.aggregate_force_refresh_confirm_ok)}
            </button>
            <button type="button" onClick={() => setConfirmRefresh(false)}>
              {t(MSG.opts_instance_cancel)}
            </button>
          </>
        ) : (
          <button type="button" className="aggregate-meta-refresh" onClick={handleForceRefreshClick}>
            {t(MSG.aggregate_force_refresh)}
          </button>
        )}
        <button
          type="button"
          className="aggregate-meta-details-toggle"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {t(MSG.aggregate_details)}
        </button>
        {refreshError && <span className="cache-error">{refreshError}</span>}
      </div>
      {detailsOpen && (
        <ul className="aggregate-details" data-testid="aggregate-details">
          {response.members.map((member, i) => {
            const badge = getMemberBadge(member.sourceId);
            return (
              <li className="aggregate-details-item" key={`${member.sourceId}-${i}`} data-ok={member.ok ? 'true' : 'false'}>
                <span className="aggregate-badge" data-member={member.sourceId}>
                  {badge.favicon && (
                    <img
                      src={resolveIconUrl(badge.favicon)}
                      alt=""
                      width={12}
                      height={12}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  <span className="aggregate-badge-label">{badge.label}</span>
                </span>
                {member.ok ? (
                  <>
                    <span>{t(MSG.aggregate_member_results, [String(member.resultCount ?? 0)])}</span>
                    <span>{member.cached ? t(MSG.aggregate_member_cached) : t(MSG.aggregate_member_realtime)}</span>
                  </>
                ) : (
                  // R6：错误分型保留（page-state vs orchestration 不折叠）。
                  <span className="aggregate-details-error">
                    {t(MSG.aggregate_member_failed_kind, [member.errorKind ?? 'unknown'])}
                    {member.errorMessage ? ` · ${member.errorMessage}` : ''}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {response.answers.length > 0 && (
        <div className="aggregate-answers">
          <h3 className="aggregate-answers-heading">{t(MSG.aggregate_answers_heading)}</h3>
          {response.answers.map((entry, i) => {
            const badge = getMemberBadge(entry.sourceId);
            return (
              <section className="answer-card aggregate-answer" key={`${entry.sourceId}-${i}`} data-member={entry.sourceId}>
                <h3>
                  {badge.favicon && (
                    <span className="answer-card-mark" aria-hidden="true">
                      <img
                        src={resolveIconUrl(badge.favicon)}
                        alt=""
                        width={14}
                        height={14}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </span>
                  )}
                  <span className="aggregate-badge-label">{badge.label}</span>
                </h3>
                <p className="answer-text">{entry.answer.text}</p>
                {entry.answer.citations.length > 0 && (
                  <ul className="citations">
                    {entry.answer.citations.map((c, ci) => (
                      <li key={`${c.url}-${ci}`}>
                        <a href={c.url} target="_blank" rel="noreferrer">
                          {c.title ?? c.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      <ResultList
        results={response.results}
        showScore
        sourcesForResult={(result) => result.sources.map((member) => getMemberBadge(member))}
      />
    </section>
  );
}
