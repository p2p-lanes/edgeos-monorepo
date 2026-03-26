"""Source of truth for base field definitions.

Non-configurable attributes (type, required, target) are hardcoded here.
Configurable attributes (label, section, position, placeholder, help_text, options) have
defaults here but can be overridden per popup via BaseFieldConfigs records.
"""

from typing import Any

# Default sections created for every popup.Z
# Keys are used as identifiers during creation; values define the section.
DEFAULT_SECTIONS: dict[str, dict[str, Any]] = {
    "profile": {"label": "Personal Information", "order": 0},
    "info_not_shared": {"label": "Info not shared", "order": 1},
    "companions": {"label": "Children and +1s", "order": 2},
    "scholarship": {"label": "Scholarship", "order": 3},
}

# Each entry defines:
#   - Hardcoded (never changes): type, required, target
#   - Defaults (configurable per popup): label, default_section_key, default_position,
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
        "required": True,
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
        "required": False,
        "target": "application",
        "default_section_key": "companions",
        "default_position": 0,
        "default_placeholder": "Name",
        "default_help_text": "We will approve your spouse/partner if we approve you. However please have them fill out this form as well so we have their information in our system.",
    },
    "partner_email": {
        "type": "email",
        "label": "Spouse/partner email",
        "required": False,
        "target": "application",
        "default_section_key": "companions",
        "default_position": 1,
        "default_placeholder": "Email",
        "default_help_text": "Please provide your spouse/partner's email so we can remind them to apply.",
    },
    "kids": {
        "type": "kids",
        "label": "I'm bringing kids",
        "required": False,
        "target": "application",
        "default_section_key": "companions",
        "default_position": 2,
        "default_help_text": "We will approve your kids if we approve you. Your kids do not need to fill out their own version of this form however.",
    },
    "scholarship_request": {
        "type": "boolean",
        "label": "I am requesting a scholarship",
        "required": False,
        "target": "application",
        "default_section_key": "scholarship",
        "default_position": 0,
        "default_placeholder": None,
        "default_help_text": "Apply for financial support to attend this event",
        "default_options": None,
    },
    "scholarship_details": {
        "type": "textarea",
        "label": "If you want to add any more detail in written form, you can use this textbox (you will still need to upload the video above, even if you fill this out).",
        "required": False,
        "target": "application",
        "default_section_key": "scholarship",
        "default_position": 2,
        "default_placeholder": "Describe why you need financial support...",
        "default_help_text": None,
        "default_options": None,
    },
    "scholarship_video_url": {
        "type": "url",
        "label": "Please share a ~60 second video answering why you’re applying for a scholarship and what your contribution might be. If you are applying for a scholarship and want to receive a ticket discount.",
        "required": False,
        "target": "application",
        "default_section_key": "scholarship",
        "default_position": 1,
        "default_placeholder": "https://...",
        "default_help_text": "You can upload your video to Dropbox, Google Drive, Youtube, or anywhere where you can make the link public and viewable.",
        "default_options": None,
    },
}
