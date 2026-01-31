"""
Approval Calculator Service

Calculates application status based on reviews and approval strategy.
"""

from datetime import datetime, timezone

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.application_review.models import ApplicationReviews
from app.api.application_review.schemas import ReviewDecision
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType
from app.api.popup_reviewer.models import PopupReviewers


class ApprovalCalculator:
    """Calculate application status based on reviews and strategy."""

    def calculate_status(
        self,
        strategy: ApprovalStrategies | None,
        reviews: list[ApplicationReviews],
        designated_reviewers: list[PopupReviewers],
    ) -> ApplicationStatus:
        """
        Determine the application status based on:
        1. Strategy type (auto_accept, threshold, weighted, etc.)
        2. Current reviews
        3. Veto rules (any rejection = reject)

        Returns ApplicationStatus.IN_REVIEW if no final decision can be made.
        """
        # No strategy configured - stay in review (manual mode)
        if not strategy:
            return ApplicationStatus.IN_REVIEW

        # Handle auto-accept
        if strategy.strategy_type == ApprovalStrategyType.AUTO_ACCEPT:
            return ApplicationStatus.ACCEPTED

        # Check for veto (instant rejection)
        if strategy.rejection_is_veto:
            rejections = [
                r
                for r in reviews
                if r.decision in [ReviewDecision.NO, ReviewDecision.STRONG_NO]
            ]
            if rejections:
                return ApplicationStatus.REJECTED

        # Calculate based on strategy type
        match strategy.strategy_type:
            case ApprovalStrategyType.ANY_REVIEWER:
                return self._calc_any_reviewer(reviews)
            case ApprovalStrategyType.ALL_REVIEWERS:
                return self._calc_all_reviewers(reviews, designated_reviewers)
            case ApprovalStrategyType.THRESHOLD:
                return self._calc_threshold(reviews, strategy.required_approvals)
            case ApprovalStrategyType.WEIGHTED:
                return self._calc_weighted(reviews, strategy)

        return ApplicationStatus.IN_REVIEW

    def _calc_any_reviewer(
        self, reviews: list[ApplicationReviews]
    ) -> ApplicationStatus:
        """Any single approval = accepted."""
        approvals = [
            r
            for r in reviews
            if r.decision in [ReviewDecision.YES, ReviewDecision.STRONG_YES]
        ]
        if approvals:
            return ApplicationStatus.ACCEPTED
        return ApplicationStatus.IN_REVIEW

    def _calc_all_reviewers(
        self,
        reviews: list[ApplicationReviews],
        designated_reviewers: list[PopupReviewers],
    ) -> ApplicationStatus:
        """All required reviewers must approve."""
        required_reviewer_ids = {
            r.user_id for r in designated_reviewers if r.is_required
        }

        # If no required reviewers, fall back to any reviewer
        if not required_reviewer_ids:
            return self._calc_any_reviewer(reviews)

        approved_ids = {
            r.reviewer_id
            for r in reviews
            if r.decision in [ReviewDecision.YES, ReviewDecision.STRONG_YES]
        }

        if required_reviewer_ids <= approved_ids:
            return ApplicationStatus.ACCEPTED
        return ApplicationStatus.IN_REVIEW

    def _calc_threshold(
        self,
        reviews: list[ApplicationReviews],
        required: int,
    ) -> ApplicationStatus:
        """N approvals required."""
        approvals = [
            r
            for r in reviews
            if r.decision in [ReviewDecision.YES, ReviewDecision.STRONG_YES]
        ]
        if len(approvals) >= required:
            return ApplicationStatus.ACCEPTED
        return ApplicationStatus.IN_REVIEW

    def _calc_weighted(
        self,
        reviews: list[ApplicationReviews],
        strategy: ApprovalStrategies,
    ) -> ApplicationStatus:
        """Weighted voting system."""
        score = 0
        for review in reviews:
            match review.decision:
                case ReviewDecision.STRONG_YES:
                    score += strategy.strong_yes_weight
                case ReviewDecision.YES:
                    score += strategy.yes_weight
                case ReviewDecision.NO:
                    score += strategy.no_weight
                case ReviewDecision.STRONG_NO:
                    score += strategy.strong_no_weight

        if score >= strategy.accept_threshold:
            return ApplicationStatus.ACCEPTED
        if score <= strategy.reject_threshold:
            return ApplicationStatus.REJECTED
        return ApplicationStatus.IN_REVIEW

    def recalculate_status(
        self,
        session: Session,
        application: Applications,
    ) -> Applications:
        """
        Recalculate and update application status based on current reviews.

        This method:
        1. Fetches the approval strategy for the popup
        2. Fetches all reviews for the application
        3. Fetches designated reviewers for the popup
        4. Calculates the new status
        5. Updates the application if status changed
        """
        from app.api.application.crud import applications_crud
        from app.api.application_review.crud import application_reviews_crud
        from app.api.approval_strategy.crud import approval_strategies_crud
        from app.api.popup_reviewer.crud import popup_reviewers_crud

        # Skip if not in review
        if application.status != ApplicationStatus.IN_REVIEW.value:
            return application

        # Get strategy
        strategy = approval_strategies_crud.get_by_popup(session, application.popup_id)

        # Get reviews - use find_all since we need all of them for calculation
        reviews = application_reviews_crud.find_all_by_application(
            session, application.id
        )

        # Get designated reviewers (typically bounded by design - few reviewers per popup)
        reviewers = popup_reviewers_crud.find_all_by_popup(
            session, application.popup_id
        )

        # Calculate new status
        new_status = self.calculate_status(strategy, reviews, reviewers)

        # Update if changed
        if new_status.value != application.status:
            application.status = new_status.value

            if new_status == ApplicationStatus.ACCEPTED:
                application.accepted_at = datetime.now(timezone.utc)
                # Create snapshot
                applications_crud.create_snapshot(session, application, "accepted")
            elif new_status == ApplicationStatus.REJECTED:
                # Create snapshot
                applications_crud.create_snapshot(session, application, "rejected")

            session.add(application)
            session.commit()
            session.refresh(application)

        return application


# Singleton instance
approval_calculator = ApprovalCalculator()
