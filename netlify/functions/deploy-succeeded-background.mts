const INDEXNOW_KEY = "d99d5e74d0ba4e0292721323b24138cf";
const SITE_HOST = "lhpedclinic.com.tw";
const KEY_LOCATION = `https://${SITE_HOST}/${INDEXNOW_KEY}.txt`;

const URLS_TO_SUBMIT = [
  `https://${SITE_HOST}/`,
  `https://${SITE_HOST}/docs/lihsin-clinic-intro-2026.pdf`,
];

export default async (req: Request) => {
  const payload = await req.json();
  const context = payload?.context;

  if (context && context !== "production") {
    console.log(`Skipping IndexNow: deploy context is "${context}", not production.`);
    return;
  }

  console.log(`Submitting ${URLS_TO_SUBMIT.length} URLs to IndexNow...`);

  const body = JSON.stringify({
    host: SITE_HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: URLS_TO_SUBMIT,
  });

  const engines = [
    "https://api.indexnow.org/indexnow",
    "https://www.bing.com/indexnow",
    "https://yandex.com/indexnow",
  ];

  const results = await Promise.allSettled(
    engines.map(async (engine) => {
      const res = await fetch(engine, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
      });
      console.log(`${engine} → ${res.status} ${res.statusText}`);
      return { engine, status: res.status };
    })
  );

  const summary = results.map((r) =>
    r.status === "fulfilled"
      ? `${r.value.engine}: ${r.value.status}`
      : `FAILED: ${r.reason}`
  );

  console.log("IndexNow submission complete:", summary.join(" | "));
};
