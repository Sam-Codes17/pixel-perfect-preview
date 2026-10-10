import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin, requireAuth } from "@/lib/supabase-server";
import { simulateRiftFinding, type RiftFinding } from "@/lib/rift-security-adapter";

// ── Get trust profile ────────────────────────────────────────────────────────
export const getTrustProfile = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    // Ensure profile exists (idempotent)
    await supabaseAdmin.rpc("initialize_trust_profile", { p_user_id: user.id });
    await supabaseAdmin.rpc("refresh_trust_profile_label", { p_user_id: user.id });

    const { data: profile } = await supabaseAdmin
      .from("trust_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    const { data: policy } = await supabaseAdmin
      .from("trust_score_policy")
      .select("config, version")
      .eq("is_active", true)
      .single();

    return { profile, policy };
  });

// ── Get score adjustments (history) ─────────────────────────────────────────
export const getScoreAdjustments = createServerFn({ method: "POST" })
  .validator((d: { token: string; limit?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: adjustments } = await supabaseAdmin
      .from("trust_score_adjustments")
      .select(`
        id, previous_score, score_delta, resulting_score, category,
        is_provisional, explanation, rule_reference, policy_version,
        related_transaction_id, related_incident_id, reversal_of,
        reversed_by, is_reversed, effective_at, idempotency_key
      `)
      .eq("user_id", user.id)
      .order("effective_at", { ascending: false })
      .limit(data.limit ?? 50);

    return adjustments ?? [];
  });

// ── Get security findings ────────────────────────────────────────────────────
export const getSecurityFindings = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: findings } = await supabaseAdmin
      .from("rift_security_findings")
      .select(`
        id, external_id, rule_id, rule_name, severity, finding_type,
        status, confidence, evidence, finding_timestamp, resolved_at,
        resolution_note, attribution_role, ingested_at
      `)
      .eq("attributed_user_id", user.id)
      .order("finding_timestamp", { ascending: false })
      .limit(30);

    return findings ?? [];
  });

// ── Submit review request ────────────────────────────────────────────────────
export const submitReviewRequest = createServerFn({ method: "POST" })
  .validator((d: {
    token: string;
    adjustment_id: string;
    finding_id?: string;
    user_statement: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    // Verify the adjustment belongs to this user
    const { data: adj } = await supabaseAdmin
      .from("trust_score_adjustments")
      .select("id, user_id")
      .eq("id", data.adjustment_id)
      .eq("user_id", user.id)
      .single();

    if (!adj) throw new Error("Adjustment not found or unauthorized");

    // Check no existing pending review for same adjustment
    const { data: existing } = await supabaseAdmin
      .from("trust_score_reviews")
      .select("id")
      .eq("adjustment_id", data.adjustment_id)
      .in("status", ["PENDING", "UNDER_REVIEW"])
      .single();

    if (existing) throw new Error("A review request is already pending for this adjustment");

    const { data: review, error } = await supabaseAdmin
      .from("trust_score_reviews")
      .insert({
        user_id:        user.id,
        adjustment_id:  data.adjustment_id,
        finding_id:     data.finding_id ?? null,
        user_statement: data.user_statement,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return review;
  });

// ── Get review requests ──────────────────────────────────────────────────────
export const getReviewRequests = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: reviews } = await supabaseAdmin
      .from("trust_score_reviews")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    return reviews ?? [];
  });

// ── Admin: get all trust profiles ───────────────────────────────────────────
export const adminGetTrustDashboard = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    // Admin check
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") throw new Error("UNAUTHORIZED: Admin access required");

    const { data: dashboard } = await supabaseAdmin
      .from("trust_score_admin_view")
      .select("*")
      .order("current_score", { ascending: true });

    const { data: pendingReviews } = await supabaseAdmin
      .from("trust_score_reviews")
      .select("*, trust_score_adjustments(explanation, score_delta), profiles(full_name)")
      .eq("status", "PENDING")
      .order("created_at", { ascending: true });

    const { data: recentAdjustments } = await supabaseAdmin
      .from("trust_score_adjustments")
      .select("*, profiles(full_name)")
      .order("effective_at", { ascending: false })
      .limit(20);

    const { data: policy } = await supabaseAdmin
      .from("trust_score_policy")
      .select("*")
      .eq("is_active", true)
      .single();

    return { dashboard: dashboard ?? [], pendingReviews: pendingReviews ?? [], recentAdjustments: recentAdjustments ?? [], policy };
  });

// ── Admin: resolve a review request ─────────────────────────────────────────
export const adminResolveReview = createServerFn({ method: "POST" })
  .validator((d: {
    token: string;
    review_id: string;
    decision: "UPHELD" | "REVERSED" | "PARTIAL";
    note: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") throw new Error("UNAUTHORIZED");

    const { data: review } = await supabaseAdmin
      .from("trust_score_reviews")
      .select("adjustment_id, user_id")
      .eq("id", data.review_id)
      .single();

    if (!review) throw new Error("Review not found");

    // If REVERSED, trigger the reversal function
    if (data.decision === "REVERSED") {
      await supabaseAdmin.rpc("reverse_score_adjustment", {
        p_original_adj_id: review.adjustment_id,
        p_reason: `Admin review resolved: ${data.note}`,
        p_reviewer_id: user.id,
      });
    }

    const { error } = await supabaseAdmin
      .from("trust_score_reviews")
      .update({
        status: "RESOLVED",
        reviewer_decision: data.decision,
        reviewer_note: data.note,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", data.review_id);

    if (error) throw new Error(error.message);

    return { success: true, decision: data.decision };
  });

// ── Admin: simulate a RIFT finding (testing only) ───────────────────────────
export const adminSimulateFinding = createServerFn({ method: "POST" })
  .validator((d: {
    token: string;
    finding_type: RiftFinding["finding_type"];
    severity: RiftFinding["severity"];
    confidence: RiftFinding["confidence"];
    target_user_id: string;
    rule_name?: string;
    note?: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") throw new Error("UNAUTHORIZED");

    return simulateRiftFinding({
      finding_type:       data.finding_type,
      severity:           data.severity,
      confidence:         data.confidence,
      attributed_user_id: data.target_user_id,
      rule_name:          data.rule_name,
      note:               data.note,
    });
  });

// ── Admin: recalculate a user's score ────────────────────────────────────────
export const adminRecalculateScore = createServerFn({ method: "POST" })
  .validator((d: { token: string; target_user_id: string; reason: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") throw new Error("UNAUTHORIZED");

    const { data: result } = await supabaseAdmin.rpc("recalculate_trust_score", {
      p_user_id: data.target_user_id,
      p_reason:  data.reason,
    });

    await supabaseAdmin.rpc("refresh_trust_profile_label", { p_user_id: data.target_user_id });

    return { new_score: result };
  });
