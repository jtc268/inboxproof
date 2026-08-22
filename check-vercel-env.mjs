const TOKEN = "iTXRQCs5keUu7Jhzjo6UApkM";
const TEAM = "team_FbNOzdDiiWfFv5lgrSFyzJdr";
const PROJ = "prj_BADdZkyBMP1i1xYmu2cLqP1coD14";
const url = `https://api.vercel.com/v2/projects/${PROJ}/env?teamId=${TEAM}`;
const res = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN } });
console.log("HTTP", res.status);
const data = await res.json();
if (data.error) {
  console.log("ERROR", JSON.stringify(data.error));
} else {
  const arr = Array.isArray(data) ? data : (data.results || []);
  console.log("count:", arr.length);
  for (const e of arr) {
    console.log(e.key, "=>", e.value, "| scopes:", (e.scopes || []).join(","));
  }
}
