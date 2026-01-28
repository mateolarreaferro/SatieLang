using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Handles interpolation for movement parameters (position axes and speed)
    /// </summary>
    public class MovementInterpolator
    {
        private DSPInterpolationData dspInterpData;
        private SatieDSPClock dspClock;
        private double lastUpdateTime;

        public MovementInterpolator(InterpolationData data, SatieDSPClock clock, SatieRandom rng)
        {
            dspClock = clock;
            lastUpdateTime = clock.CurrentTime;

            // Create DSPInterpolationData from InterpolationData
            dspInterpData = new DSPInterpolationData(data, rng);
        }

        public float GetValue()
        {
            if (dspInterpData == null) return 0f;

            double currentTime = dspClock.CurrentTime;
            double deltaTime = currentTime - lastUpdateTime;
            lastUpdateTime = currentTime;

            return dspInterpData.GetValue(deltaTime);
        }
    }
}
