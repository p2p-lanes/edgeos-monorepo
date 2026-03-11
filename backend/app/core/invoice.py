"""Invoice PDF generation using reportlab.

Generates a professional invoice PDF for a payment, suitable for
both API download and email attachment.
"""

from __future__ import annotations

import io
from datetime import datetime
from typing import TYPE_CHECKING
from urllib.parse import urlparse
from urllib.request import urlopen
from xml.sax.saxutils import escape

from loguru import logger
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    Flowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

if TYPE_CHECKING:
    from app.api.payment.models import Payments


# ---- Helpers ----------------------------------------------------------------


def _format_date(dt: datetime) -> str:
    """Format a datetime to YYYY-MM-DD."""
    return dt.strftime("%Y-%m-%d")


def _format_money(value: float, decimals: int = 2) -> str:
    """Format a number as money with thousands separators (dot) and decimal comma."""
    fmt = f"{{value:,.{decimals}f}}"
    s = fmt.format(value=value)
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def _is_crypto_currency(code: str) -> bool:
    return code.upper() in ("BTC", "ETH")


def _format_currency(value: float, currency: str) -> str:
    """Format a value with appropriate decimal places for the currency."""
    decimals = 8 if _is_crypto_currency(currency) else 2
    return _format_money(value, decimals)


# ---- Cropped Image Flowable -------------------------------------------------


class _CroppedImageFitWidth(Flowable):
    """Draw an image at full available width, cropping vertically to a box height.

    Maintains aspect ratio — overflow is clipped, never stretched.
    """

    def __init__(self, image_source: object, width: float, height: float) -> None:
        super().__init__()
        self.reader = ImageReader(image_source)
        self.box_w = width
        self.box_h = height
        self.width = width
        self.height = height

    def draw(self) -> None:
        canvas = self.canv
        iw, ih = self.reader.getSize()
        if iw == 0:
            return
        scale = self.box_w / float(iw)
        draw_w = self.box_w
        draw_h = ih * scale
        dy = (self.box_h - draw_h) / 2.0

        canvas.saveState()
        path = canvas.beginPath()
        path.rect(0, 0, self.box_w, self.box_h)
        canvas.clipPath(path, stroke=0)
        canvas.drawImage(self.reader, 0, dy, width=draw_w, height=draw_h, mask="auto")
        canvas.restoreState()


# ---- Main generator ---------------------------------------------------------


def generate_invoice_pdf(
    payment: Payments,
    client_name: str,
    invoice_company_name: str,
    invoice_company_address: str,
    invoice_company_email: str,
    header_image_url: str | None = None,
) -> bytes:
    """Generate an invoice PDF for a payment.

    The products table shows original unit prices. Below the table a
    subtotal / discount / total breakdown is rendered. ``payment.amount``
    is always used as the authoritative total — no recalculation is done.

    Args:
        payment: The Payment ORM instance (with products_snapshot loaded).
        client_name: Full name to show in "Bill to".
        invoice_company_name: Company name from popup config.
        invoice_company_address: Company address from popup config.
        invoice_company_email: Company email from popup config.
        header_image_url: URL of the popup header/logo image.

    Returns:
        Raw PDF bytes.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        title=f"Invoice {payment.id}",
    )

    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="Header",
            fontName="Helvetica-Bold",
            fontSize=16,
            alignment=1,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(name="Body", fontName="Helvetica", fontSize=12, leading=14)
    )
    styles.add(ParagraphStyle(name="Right", parent=styles["Body"], alignment=2))
    styles.add(
        ParagraphStyle(name="Bold", parent=styles["Body"], fontName="Helvetica-Bold")
    )
    styles.add(
        ParagraphStyle(
            name="BoldRight",
            parent=styles["Bold"],
            alignment=2,
        )
    )

    flow: list[Flowable] = []

    # ---- Header image --------------------------------------------------------
    if header_image_url:
        try:
            parsed = urlparse(header_image_url)
            if parsed.scheme in ("http", "https"):
                with urlopen(header_image_url) as resp:  # noqa: S310
                    image_bytes = resp.read()
                source: object = io.BytesIO(image_bytes)
            else:
                source = header_image_url

            box_h = 46 * mm
            img_flowable = _CroppedImageFitWidth(source, width=doc.width, height=box_h)
            flow.append(img_flowable)
            flow.append(Spacer(1, 6))
        except Exception:
            logger.warning(
                "Failed to load invoice header image from %s", header_image_url
            )

    # ---- Title ---------------------------------------------------------------
    flow.append(Paragraph("Invoice", styles["Header"]))
    flow.append(Spacer(1, 6))

    # ---- Two-column header (seller | invoice meta) ---------------------------
    left = [
        Paragraph(escape(invoice_company_name), styles["Body"]),
        Paragraph(f"Address: {escape(invoice_company_address)}", styles["Body"]),
        Paragraph(f"Email: {escape(invoice_company_email)}", styles["Body"]),
    ]
    right = [
        Paragraph(f"Date: {_format_date(payment.created_at)}", styles["Right"]),
        Paragraph(f"Invoice #: {payment.id}", styles["Right"]),
        Paragraph(f"Bill to: {escape(client_name)}", styles["Right"]),
    ]

    header_tbl = Table(
        [[left, right]],
        colWidths=[doc.width / 2, doc.width / 2],
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )
    flow.append(header_tbl)
    flow.append(Spacer(1, 12))

    # ---- Products table ------------------------------------------------------
    payment_rate = float(payment.rate) if payment.rate else 1.0
    payment_currency = payment.currency or "USD"

    headers = ["Qty", "Description", "Unit Price", "Amount"]
    show_rate = payment_rate > 1
    if show_rate:
        headers.insert(3, "Rate")

    table_data: list[list[str | Paragraph]] = [list(headers)]

    subtotal_usd = 0.0
    for item in payment.products_snapshot:
        unit_price_usd = float(item.product_price)
        qty = int(item.quantity)
        line_total_usd = unit_price_usd * qty
        subtotal_usd += line_total_usd

        desc_para = Paragraph(escape(item.product_name), styles["Body"])

        if show_rate:
            line_in_currency = line_total_usd / payment_rate
            row: list[str | Paragraph] = [
                str(qty),
                desc_para,
                f"{_format_money(unit_price_usd)} USD",
                f"1 {payment_currency} = {_format_money(payment_rate)} USD",
                f"{_format_currency(line_in_currency, payment_currency)} {payment_currency}",
            ]
        else:
            row = [
                str(qty),
                desc_para,
                f"{_format_money(unit_price_usd)} USD",
                f"{_format_money(line_total_usd)} USD",
            ]
        table_data.append(row)

    # ---- Column widths (auto-size) -------------------------------------------
    num_cols = len(headers)
    qty_min = 10 * mm
    unit_min = 24 * mm
    amount_min = 28 * mm
    rate_min = 36 * mm
    desc_min = 30 * mm

    def _measure(text: str, bold: bool = False) -> float:
        font = "Helvetica-Bold" if bold else "Helvetica"
        return stringWidth(text, font, 10)

    # Measure max width for each fixed column
    col_max = [0.0] * num_cols
    for r_idx, data_row in enumerate(table_data):
        for c_idx, cell in enumerate(data_row):
            w = _measure(str(cell), bold=(r_idx == 0))
            col_max[c_idx] = max(col_max[c_idx], w)

    pad = 10
    # Assign widths: qty=0, desc=1, unit=2, [rate=3], amount=last
    qty_w = max(qty_min, col_max[0] + pad)
    unit_w = max(unit_min, col_max[2] + pad)
    amount_w = max(amount_min, col_max[-1] + pad)
    rate_w = max(rate_min, col_max[3] + pad) if show_rate else 0

    other_sum = qty_w + unit_w + amount_w + rate_w
    desc_w = max(desc_min, doc.width - other_sum)

    col_widths = [qty_w, desc_w, unit_w]
    if show_rate:
        col_widths.append(rate_w)
    col_widths.append(amount_w)

    # ---- Table style ---------------------------------------------------------
    tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("WORDWRAP", (1, 1), (1, -1), "CJK"),
            ]
        )
    )
    flow.append(tbl)
    flow.append(Spacer(1, 10))

    # ---- Footer: Subtotal / Discount / Total ---------------------------------
    payment_amount = float(payment.amount)
    discount_value = float(payment.discount_value) if payment.discount_value else 0.0
    has_discount = discount_value > 0 or payment_amount < subtotal_usd

    # Build discount label
    discount_label = "Discount"
    if payment.coupon_code:
        discount_label = f"Discount (coupon: {payment.coupon_code})"
    elif payment.group_id and discount_value > 0:
        discount_label = f"Discount (group {discount_value:.0f}%)"
    elif discount_value > 0:
        discount_label = f"Discount ({discount_value:.0f}%)"

    # Convert amounts for crypto
    if show_rate:
        subtotal_display = _format_currency(
            subtotal_usd / payment_rate, payment_currency
        )
        total_display = _format_currency(
            payment_amount / payment_rate, payment_currency
        )
        discount_amount = (subtotal_usd - payment_amount) / payment_rate
        discount_display = _format_currency(discount_amount, payment_currency)
    else:
        subtotal_display = _format_money(subtotal_usd)
        total_display = _format_money(payment_amount)
        discount_amount = subtotal_usd - payment_amount
        discount_display = _format_money(discount_amount)

    footer_data: list[list[str | Paragraph]] = []

    if has_discount:
        footer_data.append(
            [
                Paragraph("Subtotal:", styles["Right"]),
                Paragraph(f"{subtotal_display} {payment_currency}", styles["Right"]),
            ]
        )
        footer_data.append(
            [
                Paragraph(f"{escape(discount_label)}:", styles["Right"]),
                Paragraph(
                    f"-{discount_display} {payment_currency}",
                    styles["Right"],
                ),
            ]
        )

    footer_data.append(
        [
            Paragraph("<b>Total:</b>", styles["BoldRight"]),
            Paragraph(
                f"<b>{total_display} {payment_currency}</b>",
                styles["BoldRight"],
            ),
        ]
    )

    label_w = doc.width * 0.7
    value_w = doc.width * 0.3
    footer_tbl = Table(
        footer_data,
        colWidths=[label_w, value_w],
        style=TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        ),
    )
    flow.append(footer_tbl)

    # ---- Build ---------------------------------------------------------------
    doc.build(flow)
    return buffer.getvalue()
