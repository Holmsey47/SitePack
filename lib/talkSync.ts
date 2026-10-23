import { repo } from '@/data/index';
import type { TalkBadge } from '@/data/talks';
import { isFixtureOffline } from '@/lib/fixtureOffline';
import { flushTalkQueue, getTalkQueue, noticesForUser, pendingTalksForUser, type QueuedTalk, type TalkNotice } from '@/lib/talkQueue';
import { deviceIsOnline } from '@/lib/variationQueue';

export async function talkSend(item: QueuedTalk): Promise<void> {
  if (item.action === 'question') {
    await repo.askTalk({
      talkId: item.talkId,
      versionId: item.versionId,
      personId: item.signerPersonId,
      body: item.question ?? '',
      deviceAt: item.deviceAt,
      sessionId: item.sessionId,
    });
    return;
  }
  if (item.action === 'note') {
    await repo.setTalkNote(item.talkId, item.signerPersonId, item.explainedVerbally, item.interpreterUsed);
    return;
  }
  if (item.action === 'presenter') {
    await repo.signTalkPresenter({
      talkId: item.talkId,
      versionId: item.versionId,
      signaturePng: item.signaturePng ?? '',
      deviceAt: item.deviceAt,
      sessionId: item.sessionId,
    });
    return;
  }
  await repo.signTalk({
    talkId: item.talkId,
    versionId: item.versionId,
    personId: item.signerPersonId,
    signaturePng: item.signaturePng ?? '',
    deviceAt: item.deviceAt,
    sessionId: item.sessionId,
  });
}

export async function refreshTalks(userId: string): Promise<{
  badges: TalkBadge[];
  notices: TalkNotice[];
  queued: QueuedTalk[];
}> {
  const queue = getTalkQueue();
  const online = !isFixtureOffline() && (await deviceIsOnline());
  if (online) await flushTalkQueue(queue, userId, talkSend).catch(() => undefined);
  const badges = await repo.myTalkBadges().catch(() => [] as TalkBadge[]);
  return {
    badges,
    notices: noticesForUser(await queue.listNotices(), userId),
    queued: pendingTalksForUser(await queue.list(), userId),
  };
}
