import os
import requests
import json
from typing import Optional, Dict, Any, List

class BaseAgent:
    def __init__(self, name: str, provider: str, model: str, api_key_name: str):
        self.name = name
        self.provider = provider
        self.model = model
        self.api_key_name = api_key_name
        # Check both OPENROUTER_API_KEY and OPEN_ROUTER_API_KEY
        self.api_key = os.environ.get(api_key_name, "")
        if not self.api_key and "OPENROUTER" in api_key_name:
            self.api_key = os.environ.get("OPEN_ROUTER_API_KEY", "")
        elif not self.api_key and "OPEN_ROUTER" in api_key_name:
            self.api_key = os.environ.get("OPENROUTER_API_KEY", "")
        self.transcript: List[Dict[str, Any]] = []

    def log(self, message: str, level: str = "INFO"):
        print(f"[{self.name}] [{level}] {message}")
        self.transcript.append({
            "sender": self.name,
            "message": message,
            "level": level
        })

    def call_llm(self, prompt: str, temperature: float = 0.5, max_tokens: int = 1500) -> str:
        self.log(f"Calling LLM ({self.provider}/{self.model}) with prompt length {len(prompt)}...")
        
        # Ensure we have an API key. If not, try to fallback to other keys in environment.
        api_key = self.api_key or os.environ.get(self.api_key_name, "")
        if not api_key and "OPENROUTER" in self.api_key_name:
            api_key = os.environ.get("OPEN_ROUTER_API_KEY", "")
        elif not api_key and "OPEN_ROUTER" in self.api_key_name:
            api_key = os.environ.get("OPENROUTER_API_KEY", "")

        if not api_key:
            # Fallback chain to make sure the POC works even if specific keys are missing
            fallbacks = ["GEMINI_API_KEY", "GROK_API_KEY", "NVIDIA_API_KEY", "OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"]
            for fb in fallbacks:
                val = os.environ.get(fb, "")
                if val:
                    self.log(f"API key {self.api_key_name} not found. Falling back to {fb}.", level="WARN")
                    api_key = val
                    # Adapt provider/model based on the fallback key
                    if fb == "GEMINI_API_KEY":
                        self.provider = "gemini"
                        self.model = "gemini-2.5-flash"
                    elif fb == "GROK_API_KEY":
                        self.provider = "grok"
                        self.model = "grok-3-mini"
                    elif fb == "NVIDIA_API_KEY":
                        self.provider = "nvidia"
                        self.model = "meta/llama-3.1-8b-instruct"
                    break
            
            if not api_key:
                raise ValueError(f"No API key found. Checked {self.api_key_name} and fallbacks.")

        try:
            if self.provider == "gemini":
                # Standard Google AI Developer API URL
                model_id = self.model.split("/")[-1]
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={api_key}"
                headers = {"Content-Type": "application/json"}
                body = {
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature}
                }
                resp = requests.post(url, headers=headers, json=body, timeout=30)
                resp.raise_for_status()
                res = resp.json()
                text = res.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                return text.strip()

            elif self.provider == "grok":
                url = "https://api.x.ai/v1/chat/completions"
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                }
                body = {
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": temperature,
                    "max_tokens": max_tokens
                }
                resp = requests.post(url, headers=headers, json=body, timeout=30)
                resp.raise_for_status()
                res = resp.json()
                return res["choices"][0]["message"]["content"].strip()

            elif self.provider == "openrouter":
                url = "https://openrouter.ai/api/v1/chat/completions"
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                }
                body = {
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": temperature,
                    "max_tokens": max_tokens
                }
                resp = requests.post(url, headers=headers, json=body, timeout=30)
                resp.raise_for_status()
                res = resp.json()
                return res["choices"][0]["message"]["content"].strip()

            elif self.provider == "nvidia":
                url = "https://integrate.api.nvidia.com/v1/chat/completions"
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                }
                body = {
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": temperature,
                    "max_tokens": max_tokens
                }
                resp = requests.post(url, headers=headers, json=body, timeout=30)
                resp.raise_for_status()
                res = resp.json()
                return res["choices"][0]["message"]["content"].strip()

            else:
                raise ValueError(f"Unknown provider: {self.provider}")

        except Exception as e:
            self.log(f"LLM Call failed: {e}", level="ERROR")
            # If a call fails, try a fallback request with Gemini as standard backup
            gemini_key = os.environ.get("GEMINI_API_KEY", "")
            if gemini_key and self.provider != "gemini":
                self.log("Attempting emergency backup call to Gemini...", level="WARN")
                backup_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
                try:
                    resp = requests.post(backup_url, headers={"Content-Type": "application/json"}, json={
                        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature}
                    }, timeout=20)
                    resp.raise_for_status()
                    return resp.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                except Exception as backup_err:
                    self.log(f"Gemini backup call also failed: {backup_err}", level="ERROR")
            raise e

    def extract_json(self, raw_text: str) -> Any:
        if not raw_text:
            return None
        text = raw_text.replace("<thinking>", "").replace("</thinking>", "")
        re_clean = text.replace("```json", "").replace("```", "").strip()
        try:
            return json.loads(re_clean)
        except json.JSONDecodeError:
            import re
            arr_start = re_clean.find("[")
            obj_start = re_clean.find("{")
            starts = [x for x in [arr_start, obj_start] if x != -1]
            if not starts:
                return None
            start = min(starts)
            open_char = re_clean[start]
            close_char = "]" if open_char == "[" else "}"
            depth = 0
            end = -1
            for i in range(start, len(re_clean)):
                if re_clean[i] == open_char:
                    depth += 1
                elif re_clean[i] == close_char:
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            if end != -1:
                try:
                    return json.loads(re_clean[start:end+1])
                except:
                    pass
            return None
