"""Pure open-set decision policy for the biometric gallery."""


def classify_identification(matches: list[dict], threshold: float, margin: float) -> str:
    if not matches:
        return "empty_gallery"
    top = float(matches[0]["similarity"])
    runner_up = float(matches[1]["similarity"]) if len(matches) > 1 else -1.0
    if top < threshold:
        return "unknown"
    if len(matches) > 1 and top - runner_up < margin:
        return "ambiguous"
    return "candidate"
