"""Unit tests for the pure translation-overlay helpers.

These cover the default-agnostic language parsing, the nested deep-merge used
for ticketing-step template_config, the leaf extractor shared with the
backoffice, and the combined step overlay. No database is required.
"""

from app.api.translation.service import (
    apply_ticketing_step_overlay,
    deep_merge_translation,
    extract_translatable_leaves,
    parse_accept_language,
)
from app.services.ai_translation import _field_hint, _map_translation_response


class TestParseAcceptLanguage:
    def test_none_and_empty_return_none(self):
        assert parse_accept_language(None) is None
        assert parse_accept_language("") is None
        assert parse_accept_language("   ") is None

    def test_english_is_not_special_cased(self):
        # Default-agnostic: "en" is parsed like any other language.
        assert parse_accept_language("en") == "en"

    def test_base_subtag_is_extracted(self):
        assert parse_accept_language("es-AR") == "es"
        assert parse_accept_language("zh-Hant") == "zh"

    def test_first_language_of_a_list_wins(self):
        assert parse_accept_language("es-AR,es;q=0.9,en;q=0.8") == "es"


class TestDeepMergeTranslation:
    def test_non_empty_string_overlay_replaces_source(self):
        assert deep_merge_translation("Hola", "Hello") == "Hello"

    def test_empty_or_missing_overlay_keeps_source(self):
        assert deep_merge_translation("Hola", "") == "Hola"
        assert deep_merge_translation("Hola", "   ") == "Hola"
        assert deep_merge_translation("Hola", None) == "Hola"

    def test_non_text_source_is_preserved(self):
        source = {"price": 100, "label": "Precio"}
        overlay = {"label": "Price"}
        assert deep_merge_translation(source, overlay) == {
            "price": 100,
            "label": "Price",
        }

    def test_nested_dict_merge(self):
        source = {"insurance": {"card_title": "Seguro", "enabled": True}}
        overlay = {"insurance": {"card_title": "Insurance"}}
        assert deep_merge_translation(source, overlay) == {
            "insurance": {"card_title": "Insurance", "enabled": True}
        }

    def test_lists_merge_element_wise_with_holes(self):
        source = ["a", "b", "c"]
        overlay = [None, None, "translated-c"]
        assert deep_merge_translation(source, overlay) == ["a", "b", "translated-c"]

    def test_source_is_not_mutated(self):
        source = {"label": "Precio", "nested": {"title": "Titulo"}}
        deep_merge_translation(source, {"nested": {"title": "Title"}})
        assert source == {"label": "Precio", "nested": {"title": "Titulo"}}


class TestExtractTranslatableLeaves:
    def test_flat_and_nested_text_leaves(self):
        config = {
            "sections": [
                {"key": "passes", "label": "Elegí tu pase", "order": 1},
            ],
            "insurance": {
                "card_title": "Seguro",
                "benefits": ["Cobertura total", "Reembolso"],
                "enabled": True,
            },
            "footer_text": "Términos y condiciones",
        }
        assert extract_translatable_leaves(config) == {
            "sections.0.label": "Elegí tu pase",
            "insurance.card_title": "Seguro",
            "insurance.benefits.0": "Cobertura total",
            "insurance.benefits.1": "Reembolso",
            "footer_text": "Términos y condiciones",
        }

    def test_faq_items_question_and_answer(self):
        config = {
            "variant": "accordion",
            "items": [
                {"id": "a", "question": "¿Otra duda?", "answer": "Escribinos"},
            ],
        }
        assert extract_translatable_leaves(config) == {
            "items.0.question": "¿Otra duda?",
            "items.0.answer": "Escribinos",
        }

    def test_hero_copy_is_fully_extracted(self):
        # Every text leaf a hero step renders, mirroring a real home config.
        # The CTA pair and the headline are the step's loudest copy, so
        # missing one leaves an organizer staring at source-language text on
        # an otherwise translated checkout with no field to fix it in.
        config = {
            "headline": "4 días de música, arte, yoga y talleres",
            "edition": "Tercera edición: El Portal",
            "subtitle": "Una celebración de amor, apertura y conexión",
            "date_badge": "Experiencia Extendida — 17, 18 y 19 de noviembre",
            "cta_label": "Ver Entradas →",
            "cta_hint": "Elegí tu entrada para comenzar",
            "bullets": ["+200 artistas y facilitadores", "+10 escenarios"],
            "logo_url": "https://cdn.example/logo.webp",
            "variant": "presentation",
        }
        assert extract_translatable_leaves(config) == {
            "headline": "4 días de música, arte, yoga y talleres",
            "edition": "Tercera edición: El Portal",
            "subtitle": "Una celebración de amor, apertura y conexión",
            "date_badge": "Experiencia Extendida — 17, 18 y 19 de noviembre",
            "cta_label": "Ver Entradas →",
            "cta_hint": "Elegí tu entrada para comenzar",
            "bullets.0": "+200 artistas y facilitadores",
            "bullets.1": "+10 escenarios",
        }

    def test_ignores_non_text_and_blank_values(self):
        config = {"presets": [10, 20], "label": "  ", "minimum": 5}
        assert extract_translatable_leaves(config) == {}

    def test_machine_keys_are_never_extracted(self):
        # `key` and `id` pair a translated leaf back to its source row, and
        # `variant`/`*_url` drive rendering. Translating any of them would
        # corrupt the config rather than localize it.
        config = {
            "variant": "presentation",
            "logo_url": "https://cdn.example/a.webp",
            "items": [{"id": "174d6487", "key": "passes", "question": "¿Vale?"}],
        }
        assert extract_translatable_leaves(config) == {"items.0.question": "¿Vale?"}

    def test_non_dict_input_is_safe(self):
        assert extract_translatable_leaves(None) == {}
        assert extract_translatable_leaves("string") == {}


class TestApplyTicketingStepOverlay:
    def test_none_translation_is_noop(self):
        data = {"title": "Titulo", "template_config": {"footer_text": "Pie"}}
        assert apply_ticketing_step_overlay(data, None) == data

    def test_flat_and_nested_overlay_combined(self):
        data = {
            "title": "Titulo",
            "description": "Desc",
            "template_config": {
                "sections": [{"key": "passes", "label": "Pases"}],
                "footer_text": "Pie",
            },
        }
        translation = {
            "title": "Title",
            "template_config": {
                "sections": [{"label": "Passes"}],
            },
        }
        result = apply_ticketing_step_overlay(data, translation)
        assert result["title"] == "Title"
        assert result["description"] == "Desc"
        assert result["template_config"]["sections"][0] == {
            "key": "passes",
            "label": "Passes",
        }
        assert result["template_config"]["footer_text"] == "Pie"

    def test_watermark_is_overlaid(self):
        data = {"title": "Titulo", "watermark": "Elegi tus entradas"}
        translation = {"title": "Title", "watermark": "Pick your tickets"}
        result = apply_ticketing_step_overlay(data, translation)
        assert result["title"] == "Title"
        assert result["watermark"] == "Pick your tickets"


class TestFieldHint:
    def test_flat_key(self):
        assert _field_hint("name") == "name"
        assert _field_hint("help_text") == "help text"

    def test_nested_key_drops_indices(self):
        assert _field_hint("sections.0.label") == "sections label"
        assert _field_hint("insurance.card_title") == "insurance card title"
        assert _field_hint("items.3.question") == "items question"


class TestMapTranslationResponse:
    def test_tokens_map_back_to_real_keys(self):
        real_by_token = {"t0": "title", "t1": "sections.0.label"}
        raw = {"t0": "Accommodation", "t1": "Camping right"}
        assert _map_translation_response(raw, real_by_token) == {
            "title": "Accommodation",
            "sections.0.label": "Camping right",
        }

    def test_unknown_tokens_are_dropped(self):
        assert _map_translation_response({"t9": "x"}, {"t0": "title"}) == {}

    def test_nested_or_non_string_values_are_dropped(self):
        # A model that ignored the opaque keys and nested its output must not
        # leak structural objects back as translations.
        raw = {"t0": {"sections": [{"label": "x"}]}, "t1": "Ok"}
        real_by_token = {"t0": "sections.0.label", "t1": "title"}
        assert _map_translation_response(raw, real_by_token) == {"title": "Ok"}
