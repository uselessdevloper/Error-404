import { backendData } from "./generated/backendData.js";

const referenceToday = "2026-06-21";
const allowedOverdueSources = new Set(["jira", "github"]);
const overdueCounts = { jira: 0, github: 0 };
export const sources = backendData.sources.map(source => {
  const sourceId = source.id;
  const items = source.items.map(item => {
    if (item.due && item.due < referenceToday) {
      if (allowedOverdueSources.has(sourceId) && overdueCounts[sourceId] < 1) {
        overdueCounts[sourceId]++;
        return { ...item, due: "2026-06-18" };
      } else {
        return { ...item, due: referenceToday };
      }
    }
    return item;
  });
  return { ...source, items };
});

export const calendarBlocks = backendData.calendarBlocks;
export const demoProfiles = backendData.demoProfiles;
export const meetingsData = backendData.meetings;
export const logoDataUrl = backendData.logoDataUrl || "";