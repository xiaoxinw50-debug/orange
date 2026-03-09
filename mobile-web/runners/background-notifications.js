const CONFIG_KEY = 'orange_notification_config';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getCategoryLabel(category) {
  const labels = {
    memory: '纪事',
    album: '相册',
    diary: '随笔',
    story: '浮梦'
  };
  return labels[category] || '内容';
}

function getPreviewText(item) {
  const preview = String(item?.preview || '').trim();
  if (preview) return preview.slice(0, 48);
  const fallback = String(item?.title || '').trim();
  return fallback || '对方刚刚留下了一条新内容。';
}

async function readStoredJson(key) {
  const stored = await CapacitorKV.get(key);
  if (!stored?.value) return null;
  try {
    return JSON.parse(stored.value);
  } catch (error) {
    return null;
  }
}

async function writeStoredJson(key, value) {
  await CapacitorKV.set(key, JSON.stringify(value));
}

addEventListener('configureNotifications', async (resolve, reject, args) => {
  try {
    const nextConfig = {
      enabled: Boolean(args?.enabled),
      viewer: String(args?.viewer || '').trim(),
      apiBase: normalizeBaseUrl(args?.apiBase),
      mutedCategories: Array.isArray(args?.mutedCategories) ? args.mutedCategories : []
    };
    await writeStoredJson(CONFIG_KEY, nextConfig);
    const lastNotifiedTime = Math.max(0, Number(args?.lastNotifiedTime || 0));
    if (nextConfig.viewer && lastNotifiedTime > 0) {
      await CapacitorKV.set(`orange_last_notified_${nextConfig.viewer}`, String(lastNotifiedTime));
    }
    resolve();
  } catch (error) {
    reject(error);
  }
});

addEventListener('orangeNotificationCheck', async resolve => {
  try {
    const config = await readStoredJson(CONFIG_KEY);
    if (!config?.enabled || !config.viewer || !config.apiBase) {
      return resolve();
    }

    const lastKey = `orange_last_notified_${config.viewer}`;
    const lastStored = await CapacitorKV.get(lastKey);
    const since = Math.max(0, Number(lastStored?.value || 0));
    const url = `${config.apiBase}/api/notifications/check?viewer=${encodeURIComponent(config.viewer)}&since=${since}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return resolve();
    }

    const payload = await response.json();
    const latestTime = Math.max(0, Number(payload?.latestTime || 0));
    const latestItem = payload?.latestItem;
    const unseenCount = Math.max(0, Number(payload?.unseenCount || 0));

    if (!latestTime || latestTime <= since || !latestItem) {
      return resolve();
    }

    const categoryLabel = getCategoryLabel(latestItem.category);
    const body = unseenCount > 1
      ? `${latestItem.author} 刚刚新增了 ${unseenCount} 条内容，最新是一条${categoryLabel}：${getPreviewText(latestItem)}`
      : `${latestItem.author} 刚刚新增了一条${categoryLabel}：${getPreviewText(latestItem)}`;

    await CapacitorNotifications.schedule([{
      id: Math.floor(Date.now() % 2147483000),
      title: '橙心回忆',
      body,
      scheduleAt: new Date(Date.now() + 1000),
      channelId: 'content-updates',
      smallIcon: 'ic_stat_orange'
    }]);

    await CapacitorKV.set(lastKey, String(latestTime));
  } catch (error) {
    console.error('[orangeNotificationCheck] failed', error);
  }
  resolve();
});
