"""Source of truth for base field definitions.

Non-configurable attributes (type, label, required, target) are hardcoded here.
Configurable attributes (section, position, placeholder, help_text, options) have
defaults here but can be overridden per popup via BaseFieldConfigs records.
"""

from typing import Any

# Default sections created for every popup.Z
# Keys are used as identifiers during creation; values define the section.
DEFAULT_SECTIONS: dict[str, dict[str, Any]] = {
    "profile": {"label": "Personal Information", "order": 0},
    "info_not_shared": {"label": "Info not shared", "order": 1},
    "companions": {"label": "Children and +1s", "order": 2},
}

# Each entry defines:
#   - Hardcoded (never changes): type, label, required, target
#   - Defaults (configurable per popup): default_section_key, default_position,
#     default_placeholder, default_help_text, default_options
#
# help_text supports {popup_name} template interpolation at render time.
BASE_FIELD_DEFINITIONS: dict[str, dict[str, Any]] = {
    "first_name": {
        "type": "text",
        "label": "First name",
        "required": True,
        "target": "human",
        "default_section_key": "profile",
        "default_position": 0,
    },
    "last_name": {
        "type": "text",
        "label": "Last name",
        "required": True,
        "target": "human",
        "default_section_key": "profile",
        "default_position": 1,
    },
    "telegram": {
        "type": "text",
        "label": "Telegram username",
        "required": True,
        "target": "human",
        "default_section_key": "profile",
        "default_position": 2,
        "default_placeholder": "username",
        "default_help_text": (
            "The primary form of communication during {popup_name} "
            "will be a Telegram group, so create an account if you don't already have one"
        ),
    },
    "residence": {
        "type": "text",
        "label": "Usual location of residence",
        "required": False,
        "target": "human",
        "default_section_key": "profile",
        "default_position": 3,
        "default_placeholder": "City, State/Region, Country",
        "default_help_text": "Please format it like [City, State/Region, Country].",
    },
    "gender": {
        "type": "select",
        "label": "Gender",
        "required": True,
        "target": "human",
        "default_section_key": "profile",
        "default_position": 4,
        "default_options": ["Male", "Female", "Non-binary", "Specify"],
    },
    "age": {
        "type": "select",
        "label": "Age",
        "required": True,
        "target": "human",
        "default_section_key": "profile",
        "default_position": 5,
        "default_options": ["18-24", "25-34", "35-44", "45-54", "55+"],
    },
    "referral": {
        "type": "text",
        "label": "Did anyone refer you?",
        "required": False,
        "target": "application",
        "default_section_key": "profile",
        "default_position": 6,
        "default_help_text": "List everyone who encouraged you to apply.",
    },
    "info_not_shared": {
        "type": "multiselect",
        "label": "Info I'm NOT willing to share with other attendees",
        "required": False,
        "target": "application",
        "default_section_key": "info_not_shared",
        "default_position": 0,
        "default_help_text": (
            "We will make a directory to make it easier for attendees to coordinate"
        ),
        "default_options": [
            "Email",
            "Telegram",
            "Organization",
            "Role",
            "Gender",
            "Age",
            "Residence",
        ],
    },
    "partner": {
        "type": "text",
        "label": "Name of spouse/partner + duration of their stay",
        "required": True,
        "target": "application",
        "default_section_key": "companions",
        "default_position": 0,
        "default_placeholder": "Name",
        "default_help_text": "We will approve your spouse/partner if we approve you. However please have them fill out this form as well so we have their information in our system.",
    },
    "partner_email": {
        "type": "email",
        "label": "Spouse/partner email",
        "required": True,
        "target": "application",
        "default_section_key": "companions",
        "default_position": 1,
        "default_placeholder": "Email",
        "default_help_text": "Please provide your spouse/partner's email so we can remind them to apply.",
    },
    "kids": {
        "type": "kids",
        "label": "I’m bringing kids",
        "required": False,
        "target": "application",
        "default_section_key": "companions",
        "default_position": 2,
        "default_help_text": "We will approve your kids if we approve you. Your kids do not need to fill out their own version of this form however.",
    },
}
