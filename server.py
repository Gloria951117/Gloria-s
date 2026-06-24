from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

import app


FINAL_LABEL_CHUNK_SIZE = max(1, int(os.environ.get("VOC_FINAL_LABEL_CHUNK_SIZE", "8")))
DIMENSION_PRODUCT_TAG_LIMIT = max(20, int(os.environ.get("VOC_DIMENSION_PRODUCT_TAG_LIMIT", "60")))
DIMENSION_CONTEXT_TAG_LIMIT = max(20, int(os.environ.get("VOC_DIMENSION_CONTEXT_TAG_LIMIT", "60")))
DIMENSION_EVIDENCE_LIMIT = max(40, int(os.environ.get("VOC_DIMENSION_EVIDENCE_LIMIT", "120")))


def chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def compact_usage(usages: list[dict]) -> dict:
    result = {"calls": len(usages)}
    for usage in usages:
        if not isinstance(usage, dict):
            continue
        for key, value in usage.items():
            if isinstance(value, int):
                result[key] = result.get(key, 0) + value
        details = usage.get("completion_tokens_details")
        if isinstance(details, dict):
            for key, value in details.items():
                if isinstance(value, int):
                    result["completion_" + key] = result.get("completion_" + key, 0) + value
    return result


def retryable_json_error(error: Exception) -> bool:
    text = str(error)
    return isinstance(error, json.JSONDecodeError) or any(
        marker in text
        for marker in [
            "Expecting ',' delimiter",
            "Unterminated string",
            "Invalid control character",
            "Extra data",
            "missing reviews array",
        ]
    )


class ModelJsonError(ValueError):
    def __init__(self, message: str, content: str, usage: dict):
        super().__init__(message)
        self.content = content
        self.usage = usage


def deepseek_chat_raw(api_key: str, model: str, messages: list[dict], max_tokens=12000, temperature=0.1, timeout=240):
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        f"{app.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"DeepSeek HTTP {e.code}: {detail[:1000]}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"DeepSeek connection error: {e}")
    return data["choices"][0]["message"]["content"], data.get("usage", {})


def deepseek_json(api_key: str, model: str, messages: list[dict], max_tokens=12000, temperature=0.1, timeout=240):
    content, usage = deepseek_chat_raw(api_key, model, messages, max_tokens, temperature, timeout)
    try:
        return app.extract_json_from_text(content), usage
    except json.JSONDecodeError as e:
        raise ModelJsonError(str(e), content, usage) from e


def compact_dimension_prompt(project: dict, candidates: dict, atomic: list[dict]) -> list[dict]:
    prompt_candidates = {
        "product_atomic_pool": (candidates.get("product_atomic_pool", []) or [])[:DIMENSION_PRODUCT_TAG_LIMIT],
        "context_atomic_pool": (candidates.get("context_atomic_pool", []) or [])[:DIMENSION_CONTEXT_TAG_LIMIT],
    }
    candidate_tags = {item.get("atomic_tag", "") for item in prompt_candidates["product_atomic_pool"] + prompt_candidates["context_atomic_pool"]}
    compact_atomic = []
    seen = set()
    for row in atomic:
        for tag in row.get("atomic_tags", []) or []:
            tag_text = tag.get("atomic_tag_zh", "")
            if tag_text not in candidate_tags and len(compact_atomic) >= DIMENSION_EVIDENCE_LIMIT // 2:
                continue
            if tag_text in seen and len(compact_atomic) >= DIMENSION_EVIDENCE_LIMIT:
                continue
            compact_atomic.append(
                {
                    "review_id": row.get("review_id", ""),
                    "atomic_tag_zh": tag_text,
                    "sentiment": tag.get("sentiment", ""),
                    "usage_marks": tag.get("usage_marks", []),
                    "evidence_original": tag.get("evidence_original", ""),
                }
            )
            seen.add(tag_text)
            if len(compact_atomic) >= DIMENSION_EVIDENCE_LIMIT:
                break
        if len(compact_atomic) >= DIMENSION_EVIDENCE_LIMIT:
            break
    task = {
        "task": "build_dimension_draft_from_atomic_tags",
        "product": {"name": project.get("name", ""), "category": project.get("category", ""), "description": project.get("description", "")},
        "candidates": prompt_candidates,
        "atomic_evidence_sample": compact_atomic,
        "requirements": [
            "基于完整语义归类，不要关键词机械聚类。",
            "产品购买决策维度是买家会用来判断购买/留用/退货的一级问题。",
            "Context 字段只放人群、场景、用途、购买路径、使用阻碍等背景信息。",
            "产品维度 6-8 个，Context 字段 8-12 个。",
            "字段写短句，边界清楚但不要长篇解释。",
            "输出中文，只输出严格 JSON object。",
        ],
        "output_schema": {
            "decision_dimensions": [
                {
                    "name_zh": "string",
                    "definition_zh": "string",
                    "decision_question_zh": "string",
                    "p_rule_zh": "string",
                    "n_rule_zh": "string",
                    "m_rule_zh": "string",
                    "zero_rule_zh": "string",
                    "boundary_zh": "string",
                    "source_atomic_tags": ["string"],
                    "listing_use_zh": "string",
                }
            ],
            "context_fields": [
                {
                    "name_zh": "string",
                    "definition_zh": "string",
                    "evidence_required_zh": "string",
                    "boundary_zh": "string",
                    "source_atomic_tags": ["string"],
                    "analysis_use_zh": "string",
                }
            ],
            "overflow_or_other": [{"theme_zh": "string", "reason_zh": "string"}],
            "need_human_decisions": ["string"],
        },
    }
    return [
        {"role": "system", "content": app.SKILL_RULE + "\n你现在只生成可讨论的维度草案，必须输出 json object。"},
        {"role": "user", "content": json.dumps(task, ensure_ascii=False)},
    ]


def repair_dimension_prompt(project: dict, candidates: dict, broken_content: str, error: str) -> list[dict]:
    task = {
        "task": "repair_or_rebuild_dimension_draft_json",
        "product": {"name": project.get("name", ""), "category": project.get("category", ""), "description": project.get("description", "")},
        "parse_error": error,
        "broken_output": broken_content[:12000],
        "candidate_atomic_tags": {
            "product_atomic_pool": (candidates.get("product_atomic_pool", []) or [])[:DIMENSION_PRODUCT_TAG_LIMIT],
            "context_atomic_pool": (candidates.get("context_atomic_pool", []) or [])[:DIMENSION_CONTEXT_TAG_LIMIT],
        },
        "requirements": [
            "只输出严格 JSON object，不要 Markdown。",
            "优先修复 broken_output；如果明显截断，基于候选标签补全。",
            "产品维度 6-8 个，Context 字段 8-12 个。",
        ],
    }
    return [
        {"role": "system", "content": app.SKILL_RULE + "\n你现在修复维度草案 JSON。必须输出可被 json.loads 解析的 json object。"},
        {"role": "user", "content": json.dumps(task, ensure_ascii=False)},
    ]


def clean_text(value, default=""):
    text = str(value or "").strip()
    return text or default


def fallback_dimension_model(candidates: dict, warning: str):
    decision = []
    for index, item in enumerate((candidates.get("product_atomic_pool", []) or [])[:8], start=1):
        tag = clean_text(item.get("atomic_tag"), f"候选产品表现{index}")
        decision.append(
            {
                "name_zh": f"待确认产品维度{index}",
                "definition_zh": f"由候选语义“{tag}”触发，需人工归并为更清晰的购买决策维度。",
                "decision_question_zh": "该产品表现是否影响买家购买、留用或退货判断？",
                "p_rule_zh": "原文明确表达该表现满足需求或优于预期。",
                "n_rule_zh": "原文明确表达该表现失败、限制使用或低于预期。",
                "m_rule_zh": "只客观提到该表现，没有明确好坏。",
                "zero_rule_zh": "未提及或不能语义支持该维度。",
                "boundary_zh": "这是系统保底草案，需人工改名、合并、删除并补充边界后再锁定。",
                "source_atomic_tags": [tag],
                "listing_use_zh": "确认后可用于卖点排序、风险说明或图片信息层级。",
            }
        )
    context_fields = []
    for index, item in enumerate((candidates.get("context_atomic_pool", []) or [])[:12], start=1):
        tag = clean_text(item.get("atomic_tag"), f"候选背景信息{index}")
        context_fields.append(
            {
                "name_zh": f"待确认Context{index}",
                "definition_zh": f"由候选语义“{tag}”触发，需人工判断是否属于人群、场景、用途或购买路径。",
                "evidence_required_zh": "必须有原文明确背景证据，不能从产品类型或评价倾向推断。",
                "boundary_zh": "这是系统保底草案，需人工改名、合并、删除并补充边界后再锁定。",
                "source_atomic_tags": [tag],
                "analysis_use_zh": "确认后可用于理解用户画像、使用场景或购买路径。",
            }
        )
    return {
        "decision_dimensions": decision,
        "context_fields": context_fields,
        "overflow_or_other": [],
        "need_human_decisions": [
            "模型维度草案 JSON 输出不完整，系统已用候选语义池生成保底草案。",
            "请重点检查维度名称、合并关系和 P/N/M/0 边界后再锁定规则。",
            warning[:300],
        ],
    }


def normalize_dimension_model(draft: dict, candidates: dict, warning: str = ""):
    if not isinstance(draft, dict):
        draft = {}
    decision = draft.get("decision_dimensions", [])
    context = draft.get("context_fields", [])
    if not isinstance(decision, list):
        decision = []
    if not isinstance(context, list):
        context = []
    if not decision and not context:
        return fallback_dimension_model(candidates, warning or "模型未返回可用维度。")
    draft["decision_dimensions"] = decision[:12]
    draft["context_fields"] = context[:16]
    draft["overflow_or_other"] = draft.get("overflow_or_other", []) if isinstance(draft.get("overflow_or_other", []), list) else []
    draft["need_human_decisions"] = draft.get("need_human_decisions", []) if isinstance(draft.get("need_human_decisions", []), list) else []
    if warning:
        draft["need_human_decisions"].append(warning[:300])
    return draft


def generate_dimension_model(project_id: str, api_key: str, model: str, mock: bool):
    project = app.get_project(project_id)
    atomic = app.read_json(app.project_dir(project_id) / "atomic_results.json", [])
    candidates = app.read_json(app.project_dir(project_id) / "dimension_candidates.json", {}) or app.propose_dimensions(project_id)
    if mock:
        draft, usage = app.mock_dimension_model(candidates), {"mock": True}
    else:
        try:
            draft, usage = deepseek_json(api_key, model, compact_dimension_prompt(project, candidates, atomic), max_tokens=16000, temperature=0.08, timeout=360)
        except ModelJsonError as first_error:
            usages = [first_error.usage]
            warning = f"第一次维度草案 JSON 解析失败：{first_error}"
            try:
                draft, repair_usage = deepseek_json(api_key, model, repair_dimension_prompt(project, candidates, first_error.content, str(first_error)), max_tokens=14000, temperature=0, timeout=360)
                usages.append(repair_usage)
                usage = compact_usage(usages)
            except Exception as repair_error:
                draft = fallback_dimension_model(candidates, f"{warning}；二次修复失败：{repair_error}")
                usage = compact_usage(usages + [{"fallback": 1}])
    draft = normalize_dimension_model(draft, candidates)
    draft["model"] = model
    draft["usage"] = usage
    draft["generated_at"] = app.now_iso()
    app.archive_and_remove(project_id, ["locked_dimensions.json", "final_labels.json", "analysis_summary.json"])
    app.write_json(app.project_dir(project_id) / "dimension_model.json", draft)
    app.update_project(project_id, {"stage": "dimension_draft_ready"})
    return draft


def final_label_model_call(project: dict, rules: dict, reviews: list[dict], atomic_rows: list[dict], api_key: str, model: str):
    try:
        result, usage = app.deepseek_chat(
            api_key,
            model,
            app.final_label_prompt(project, rules, reviews, atomic_rows),
            max_tokens=12000,
            temperature=0.08,
        )
        return result, [usage]
    except Exception as error:
        if len(reviews) <= 1 or not retryable_json_error(error):
            raise
        mid = max(1, len(reviews) // 2)
        left_ids = {r["review_id"] for r in reviews[:mid]}
        right_ids = {r["review_id"] for r in reviews[mid:]}
        left_atomic = [row for row in atomic_rows if row.get("review_id") in left_ids]
        right_atomic = [row for row in atomic_rows if row.get("review_id") in right_ids]
        left_result, left_usage = final_label_model_call(project, rules, reviews[:mid], left_atomic, api_key, model)
        right_result, right_usage = final_label_model_call(project, rules, reviews[mid:], right_atomic, api_key, model)
        return {"reviews": (left_result.get("reviews") or []) + (right_result.get("reviews") or [])}, left_usage + right_usage


def process_final_batch(project_id: str, batch_id: str, api_key: str, model: str, mock: bool) -> dict:
    project = app.get_project(project_id)
    rules = app.rules_for_project(project_id)
    batch, reviews = app.batch_reviews(project_id, batch_id)
    if not project:
        raise ValueError("project_not_found")
    if not rules.get("decision_dimensions") and not rules.get("context_fields"):
        raise ValueError("missing_locked_dimensions")
    if not batch:
        raise ValueError("batch_not_found")
    if not reviews:
        raise ValueError("empty_batch")
    if not mock and not api_key:
        raise ValueError("missing_deepseek_key")

    app.set_batch_status(project_id, batch_id, status="final_running", model=model, started_at=app.now_iso(), error="")
    started = time.time()
    try:
        if mock:
            result = {
                "reviews": [
                    {
                        "review_id": r["review_id"],
                        "dimensions": {},
                        "context": {},
                        "other": {"T": "0", "R": "无"},
                        "need_review": True,
                        "review_flags": ["模拟最终打标，不作为正式结果"],
                    }
                    for r in reviews
                ]
            }
            usage = {"mock": True}
        else:
            all_rows = []
            all_errors = []
            usages = []
            for review_chunk in chunks(reviews, FINAL_LABEL_CHUNK_SIZE):
                review_ids = {r["review_id"] for r in review_chunk}
                atomic_rows = app.atomic_for_review(project_id, review_ids)
                chunk_result, chunk_usages = final_label_model_call(project, rules, review_chunk, atomic_rows, api_key, model)
                normalized_chunk, chunk_errors = app.normalize_final_result(chunk_result, review_ids, rules)
                all_rows.extend(normalized_chunk.get("reviews", []))
                all_errors.extend(chunk_errors)
                usages.extend(chunk_usages)
            result = {"reviews": all_rows}
            usage = compact_usage(usages)

        review_ids = {r["review_id"] for r in reviews}
        normalized, errors = app.normalize_final_result(result, review_ids, rules)
        if not mock:
            errors = all_errors + errors
        app.merge_final_labels(project_id, batch_id, normalized, usage)
        app.set_batch_status(
            project_id,
            batch_id,
            status="final_done" if not errors else "final_done_with_warnings",
            finished_at=app.now_iso(),
            error="；".join(errors[:5]),
        )
        app.update_project(project_id, {"stage": "final_labeling"})
        return {
            "status": "ok",
            "validation_errors": errors,
            "usage": usage,
            "duration_sec": round(time.time() - started, 1),
            "stats": app.project_stats(project_id),
        }
    except Exception as e:
        app.set_batch_status(project_id, batch_id, status="final_failed", finished_at=app.now_iso(), error=str(e)[:1200])
        raise


app.process_final_batch = process_final_batch
app.generate_dimension_model = generate_dimension_model


if __name__ == "__main__":
    app.main()
