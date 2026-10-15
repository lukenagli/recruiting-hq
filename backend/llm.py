"""The one place that builds models. Every Agent gets its model passed explicitly at run time.

Who pays for a request:
- a user who saved their own Claude or OpenAI key: their key, always;
- otherwise the site's admin account: the course key through Portkey (MODEL_NAME only);
- anyone else: no model. They are asked to add their own key in Settings.
"""
from dataclasses import dataclass
from functools import lru_cache

from openai import AsyncOpenAI
from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings

from . import config, user_keys


class NoModelError(Exception):
    """This account has no way to call a model yet."""


@dataclass
class Chosen:
    model: Model
    provider: str  # "anthropic" | "openai" | "course"
    settings: ModelSettings | None = None


@lru_cache(maxsize=1)
def get_model() -> OpenAIResponsesModel:
    """The course model through Portkey (the site owner's key)."""
    client = AsyncOpenAI(
        api_key=config.portkey_api_key(),
        base_url=config.PORTKEY_BASE_URL,
        default_headers={"x-portkey-provider": "openai"},
    )
    return OpenAIResponsesModel(config.MODEL_NAME, provider=OpenAIProvider(openai_client=client))


def model_for(user: dict) -> Chosen:
    own = user_keys.stored(user["id"])
    if own:
        provider, key = own
        if provider == "anthropic":
            # Opus 5.5 always thinks; leave room for that plus the answer.
            return Chosen(AnthropicModel(config.CLAUDE_MODEL, provider=AnthropicProvider(api_key=key)), "anthropic",
                          ModelSettings(max_tokens=16000))
        return Chosen(OpenAIResponsesModel(config.USER_OPENAI_MODEL, provider=OpenAIProvider(api_key=key)), "openai")
    if user.get("is_admin") and config.PORTKEY_API_KEY_SET:
        return Chosen(get_model(), "course")
    raise NoModelError("To use the AI features, add your own Claude or OpenAI API key in Settings. Your usage is billed to your key.")


def usage_dict(usage) -> dict:
    """Token counts for the tokenomics log: input, cached input, output."""
    return {
        "input_tokens": usage.input_tokens or 0,
        "cached_input_tokens": usage.cache_read_tokens or 0,
        "output_tokens": usage.output_tokens or 0,
        "requests": getattr(usage, "requests", 0) or 0,
    }
