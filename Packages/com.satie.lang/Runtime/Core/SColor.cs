using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Handles color application and interpolation for visual components
    /// </summary>
    public class SColor : MonoBehaviour
    {
        private Color? staticColor;
        private MovementInterpolator rInterpolator;
        private MovementInterpolator gInterpolator;
        private MovementInterpolator bInterpolator;
        private Renderer[] renderers;
        private TrailRenderer[] trailRenderers;

        public void Initialize(SatieDSPClock clock, SatieRandom random, Statement statement)
        {
            staticColor = statement.staticColor;

            // Create interpolators for RGB channels if needed
            if (statement.colorRInterpolation != null)
            {
                rInterpolator = new MovementInterpolator(statement.colorRInterpolation, clock, random);
            }

            if (statement.colorGInterpolation != null)
            {
                gInterpolator = new MovementInterpolator(statement.colorGInterpolation, clock, random);
            }

            if (statement.colorBInterpolation != null)
            {
                bInterpolator = new MovementInterpolator(statement.colorBInterpolation, clock, random);
            }

            // Find all renderers in children
            renderers = GetComponentsInChildren<Renderer>(true);
            trailRenderers = GetComponentsInChildren<TrailRenderer>(true);

            // Apply initial color if static
            if (staticColor.HasValue)
            {
                ApplyColor(staticColor.Value);
            }
        }

        void Update()
        {
            // If using interpolation, update color each frame
            if (rInterpolator != null || gInterpolator != null || bInterpolator != null)
            {
                float r = rInterpolator != null ? rInterpolator.GetValue() : 1f;
                float g = gInterpolator != null ? gInterpolator.GetValue() : 1f;
                float b = bInterpolator != null ? bInterpolator.GetValue() : 1f;

                Color interpolatedColor = new Color(r, g, b, 1f);
                ApplyColor(interpolatedColor);
            }
        }

        void ApplyColor(Color color)
        {
            // Apply to all renderers except TrailRenderers (handle them separately)
            foreach (var renderer in renderers)
            {
                if (renderer != null && !(renderer is TrailRenderer))
                {
                    // Create material instance if needed
                    if (renderer.material != null)
                    {
                        renderer.material.color = color;
                    }
                }
            }

            // Apply to trail renderers using gradient
            foreach (var trailRenderer in trailRenderers)
            {
                if (trailRenderer != null)
                {
                    Color startColor = color;
                    Color endColor = new Color(color.r, color.g, color.b, 0f);

                    var grad = new Gradient();
                    grad.SetKeys(
                        new[] { new GradientColorKey(startColor, 0f), new GradientColorKey(endColor, 1f) },
                        new[] { new GradientAlphaKey(1f, 0f), new GradientAlphaKey(0f, 1f) }
                    );
                    trailRenderer.colorGradient = grad;
                }
            }
        }
    }
}
