"""Tests for generate_check_in_code helper.

TDD phase: RED — asserts 8-char codes. Currently the helper produces 4-char codes,
so these tests will FAIL until the helper is updated.

Spec: Design R2 — extend check_in_code to 8 letters to prevent migration collisions.
"""

from app.api.attendee.crud import generate_check_in_code


class TestGenerateCheckInCode:
    def test_produces_8_char_code_without_prefix(self) -> None:
        """generate_check_in_code() with no prefix should return an 8-char string."""
        code = generate_check_in_code()
        assert len(code) == 8, f"Expected 8 chars, got {len(code)}: {code!r}"

    def test_produces_code_with_prefix(self) -> None:
        """generate_check_in_code(prefix) should return prefix + 8-char suffix."""
        code = generate_check_in_code("MUV")
        assert len(code) == 11, f"Expected 11 chars (3+8), got {len(code)}: {code!r}"
        assert code.startswith("MUV"), f"Expected 'MUV' prefix, got: {code!r}"

    def test_code_is_uppercase(self) -> None:
        """All characters in the random part should be uppercase ASCII."""
        code = generate_check_in_code()
        assert code == code.upper(), f"Code should be uppercase, got: {code!r}"
        assert code.isalpha(), f"Code should be all letters, got: {code!r}"

    def test_codes_are_likely_unique(self) -> None:
        """With 26^8 ~= 208 billion combinations, 100 codes should all be distinct."""
        codes = {generate_check_in_code() for _ in range(100)}
        assert len(codes) == 100, "Expected 100 distinct codes from 100 calls"
