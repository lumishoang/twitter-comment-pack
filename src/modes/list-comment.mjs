/**
 * Mode A — crawl one or more lists, comment on each unique tweet using
 * the configured language + style.
 */
import { fetchListTweets, postTweet } from '../lib/twitter-http.mjs';
import { generateComment } from '../lib/ai-commenter.mjs';
import { alreadyCommented, markCommented, acquireTweetLock, releaseTweetLock, recentAuthorCommentCount } from '../lib/store.mjs';
import { waitForSlot, postSleep } from '../lib/rate-limiter.mjs';
import { sendAlert } from '../lib/telegram.mjs';

export async function runListMode(cfg, log) {
  const listIds = cfg.modeA?.listIds || [];
  if (listIds.length === 0) {
    log('[mode-A] no list IDs configured; skipping');
    return;
  }

  const rawMaxAgeHours = cfg.modeA?.maxTweetAgeHours;
  const hasAgeLimit = Number(rawMaxAgeHours) > 0;
  const maxAgeHours = hasAgeLimit ? Number(rawMaxAgeHours) : null;
  const maxAgeMs = hasAgeLimit ? (maxAgeHours * 60 * 60 * 1000) : null;
  const nowMs = Date.now();

  const pool = [];
  const seen = new Set();
  let skippedOld = 0;
  for (const id of listIds) {
    try {
      const tweets = await fetchListTweets(String(id).trim(), cfg.cookiesFile, 30);
      for (const t of tweets) {
        if (!t.id || !t.fullText || t.fullText.length < 10) continue;
        if (t.isRetweet) continue;
        const createdMs = new Date(t.createdAt).getTime();
        if (!Number.isFinite(createdMs)) continue;
        if (hasAgeLimit && (nowMs - createdMs) > maxAgeMs) {
          skippedOld++;
          continue;
        }
        if (seen.has(t.id)) continue;
        if (alreadyCommented(t.id)) continue;
        seen.add(t.id);
        pool.push(t);
      }
      log(`[mode-A] list ${id}: pool size now ${pool.length} (skip_old=${skippedOld}, max_age_h=${hasAgeLimit ? maxAgeHours : 'all'})`);
    } catch (e) {
      log(`[mode-A] list ${id} fetch failed: ${e.message}`);
      if (/401|403/.test(e.message)) {
        await sendAlert(cfg.telegram?.botToken, cfg.telegram?.chatId, `[twitter-comment-pack] Session expired — re-export cookies`);
        throw e;
      }
    }
  }

  pool.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  for (const t of pool) {
    if (!acquireTweetLock(t.id)) {
      log(`[mode-A] skip ${t.id}: in-flight lock exists`);
      continue;
    }

    try {
      if (alreadyCommented(t.id)) {
        log(`[mode-A] skip ${t.id}: already commented`);
        continue;
      }

      await waitForSlot(cfg, log);
      const langSetting = cfg.modeA?.language || 'auto';
      const lang = langSetting === 'auto' ? 'auto' : langSetting;

      const promptTweetText = [
        `Main post:\n${t.fullText || ''}`,
        t.quotedText ? `\nQuoted context:\n${t.quotedText}` : '',
        t.retweetedText ? `\nRetweeted context:\n${t.retweetedText}` : '',
      ].filter(Boolean).join('\n');

      const readabilitySample = [t.fullText || '', t.quotedText || '', t.retweetedText || ''].join(' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[#@]\w+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const hasReadableContent = readabilitySample.length >= 20 && /[\p{L}\p{N}]/u.test(readabilitySample);
      if (!hasReadableContent) {
        log(`[mode-A] skip ${t.id}: unreadable/insufficient content`);
        continue;
      }

      let comment;
      try {
        comment = await generateComment({
          tweetText: promptTweetText,
          lang,
          style: cfg.modeA?.stylePrompt || '',
          ai: cfg.ai,
        });
      } catch (e) {
        log(`[mode-A] AI fail for ${t.id}: ${e.message}`);
        continue;
      }

      const sameAuthorRecent = recentAuthorCommentCount(t.author || '', 45 * 60 * 1000);
      if (sameAuthorRecent >= 1) {
        log(`[mode-A] skip ${t.id}: author-cooldown @${t.author}`);
        continue;
      }

      try {
        const replyTweetId = await postTweet(comment, cfg.cookiesFile, { replyToId: t.id });
        markCommented(t.id, t.author);
        const commentUrl = `https://x.com/i/web/status/${replyTweetId}`;
        log(`[mode-A] OK reply ${t.id} @${t.author} lang=${lang} reply_id=${replyTweetId} reply_url=${commentUrl} "${comment.slice(0, 60)}..."`);
      } catch (e) {
        log(`[mode-A] post fail ${t.id}: ${e.message}`);
        if (/RATE_LIMITED/.test(e.message)) {
          await sendAlert(cfg.telegram?.botToken, cfg.telegram?.chatId, `[twitter-comment-pack] Rate limited (${e.message})`);
          return;
        }
        if (/code":226|AuthorizationError|automated/i.test(e.message)) {
          const coolMs = Number(cfg.antiAbuse?.code226CooldownMs) || (15 * 60 * 1000);
          const coolMin = Math.round(coolMs / 60000);
          log(`[mode-A] anti-abuse cooldown ${coolMin} min after code226`);
          await sendAlert(cfg.telegram?.botToken, cfg.telegram?.chatId, `[twitter-comment-pack] anti-abuse 226 hit; cooldown ${coolMin} min`);
          await new Promise((r) => setTimeout(r, coolMs));
        }
        continue;
      }
      await postSleep(cfg, log);
    } finally {
      releaseTweetLock(t.id);
    }
  }
}
