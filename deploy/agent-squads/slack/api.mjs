// Slack Web API calls with the bot token (xoxb-). SLACK_API_URL points
// elsewhere, for GovSlack or a test double.

export const apiBase = () =>
  (process.env.SLACK_API_URL || "https://slack.com/api").replace(/\/$/, "");

export function slackApi(token) {
  return async function slack(method, body = {}) {
    const res = await fetch(`${apiBase()}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
    return data;
  };
}
