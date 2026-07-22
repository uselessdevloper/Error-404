import { promises as fs } from "fs";
import { resolve } from "path";

async function main() {
  const modulePath = "../src/generated/backendData.js";
  const { backendData } = await import(modulePath);
  
  const utkarshTasks = [];
  backendData.sources.forEach(source => {
    source.items.forEach(item => {
      if (item.owner && item.owner.toLowerCase().includes("utkarsh")) {
        utkarshTasks.push({
          id: item.id,
          title: item.title,
          severity: item.severity,
          due: item.due,
          source: source.id
        });
      }
    });
  });
  
  console.log(`Total tasks for Utkarsh: ${utkarshTasks.length}`);
  console.log(JSON.stringify(utkarshTasks, null, 2));
}

main().catch(console.error);
