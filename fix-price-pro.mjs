const TOKEN = "iTXRQCs5keUu7Jhzjo6UApkM";
const TEAM = "team_FbNOzdDiiWfFv5lgrSFyzJdr";
const PROJ = "prj_BADdZkyBMP1i1xYmu2cLqP1coD14";
const KEY = "STRIPE_PRICE_PRO";
const NEWVAL = "price_1U6dWBFzAAOxCQiQs2LmWAT9"; // $14.50 launch
const url = `https://api.vercel.com/v2/projects/${PROJ}/env/${KEY}?teamId=${TEAM}`;
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
  body: JSON.stringify({ value: NEWVAL, teams: [TEAM] }),
});
console.log("HTTP", res.status);
const data = await res.json();
console.log(JSON.stringify(data).slice(0, 500));
