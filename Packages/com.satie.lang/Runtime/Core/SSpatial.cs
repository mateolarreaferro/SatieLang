using UnityEngine;

namespace Satie
{
    public class SSpatial : MonoBehaviour
    {
        public Statement.WanderType type = Statement.WanderType.None;
        public Vector3 minPos, maxPos;
        public float hz = 0.3f;
        private Vector3 seed;
        private SatieDSPClock dspClock;
        private MovementInterpolator xMinInterpolator;
        private MovementInterpolator xMaxInterpolator;
        private MovementInterpolator yMinInterpolator;
        private MovementInterpolator yMaxInterpolator;
        private MovementInterpolator zMinInterpolator;
        private MovementInterpolator zMaxInterpolator;
        private MovementInterpolator speedInterpolator;
        private double lastUpdateTime;
        private float accumulatedTime;

        public void Initialize(SatieDSPClock clock, SatieRandom random, Statement statement)
        {
            dspClock = clock;
            lastUpdateTime = clock.CurrentTime;
            accumulatedTime = 0f;
            seed = new Vector3(
                random.Range(0f, 1000f),
                random.Range(0f, 1000f),
                random.Range(0f, 1000f));

            // Create interpolators for min/max of each axis
            if (statement.moveXMinInterpolation != null)
            {
                xMinInterpolator = new MovementInterpolator(statement.moveXMinInterpolation, clock, random);
            }

            if (statement.moveXMaxInterpolation != null)
            {
                xMaxInterpolator = new MovementInterpolator(statement.moveXMaxInterpolation, clock, random);
            }

            if (statement.moveYMinInterpolation != null)
            {
                yMinInterpolator = new MovementInterpolator(statement.moveYMinInterpolation, clock, random);
            }

            if (statement.moveYMaxInterpolation != null)
            {
                yMaxInterpolator = new MovementInterpolator(statement.moveYMaxInterpolation, clock, random);
            }

            if (statement.moveZMinInterpolation != null)
            {
                zMinInterpolator = new MovementInterpolator(statement.moveZMinInterpolation, clock, random);
            }

            if (statement.moveZMaxInterpolation != null)
            {
                zMaxInterpolator = new MovementInterpolator(statement.moveZMaxInterpolation, clock, random);
            }

            if (statement.moveSpeedInterpolation != null)
            {
                speedInterpolator = new MovementInterpolator(statement.moveSpeedInterpolation, clock, random);
            }
        }

        void Update()
        {
            if (type == Statement.WanderType.None || dspClock == null) return;

            // Get current speed (may be interpolated)
            float currentHz = hz;
            if (speedInterpolator != null)
            {
                currentHz = speedInterpolator.GetValue();
            }

            // Integrate speed over time to get smooth movement
            double currentTime = dspClock.CurrentTime;
            double deltaTime = currentTime - lastUpdateTime;
            lastUpdateTime = currentTime;

            float scaledHz = currentHz * 0.01f;
            accumulatedTime += (float)deltaTime * scaledHz;
            float t = accumulatedTime * 2f * Mathf.PI;

            // PerlinNoise returns 0 to 1, so (noise - 0.5) gives -0.5 to 0.5
            Vector3 noise = new Vector3(
                Mathf.PerlinNoise(seed.x, t)       - 0.5f,
                Mathf.PerlinNoise(seed.y, t * 0.8f) - 0.5f,
                Mathf.PerlinNoise(seed.z, t * 1.3f) - 0.5f);

            // Get current min/max ranges (may be interpolated)
            Vector3 currentMin = minPos;
            Vector3 currentMax = maxPos;

            if (xMinInterpolator != null)
            {
                currentMin.x = xMinInterpolator.GetValue();
            }

            if (xMaxInterpolator != null)
            {
                currentMax.x = xMaxInterpolator.GetValue();
            }

            if (yMinInterpolator != null)
            {
                currentMin.y = yMinInterpolator.GetValue();
            }

            if (yMaxInterpolator != null)
            {
                currentMax.y = yMaxInterpolator.GetValue();
            }

            if (zMinInterpolator != null)
            {
                currentMin.z = zMinInterpolator.GetValue();
            }

            if (zMaxInterpolator != null)
            {
                currentMax.z = zMaxInterpolator.GetValue();
            }

            // Map noise (-0.5 to 0.5) to the min/max range
            // Lerp from currentMin to currentMax based on noise normalized to 0-1
            Vector3 normalizedNoise = noise + new Vector3(0.5f, 0.5f, 0.5f);
            Vector3 pos = Vector3.Lerp(currentMin, currentMax, 0f);
            pos.x = Mathf.Lerp(currentMin.x, currentMax.x, normalizedNoise.x);
            pos.y = Mathf.Lerp(currentMin.y, currentMax.y, normalizedNoise.y);
            pos.z = Mathf.Lerp(currentMin.z, currentMax.z, normalizedNoise.z);

            if (type == Statement.WanderType.Walk) pos.y = 0f;

            transform.position = pos;
        }
    }
}
