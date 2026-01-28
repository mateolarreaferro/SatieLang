using UnityEngine;

namespace Satie
{
/// <summary>
/// Decodes First-Order Ambisonic (FOA) B-format audio to binaural stereo using HRTF-based virtual loudspeakers.
/// Implements a simple but effective virtual loudspeaker approach for spatial audio rendering.
/// </summary>
public class AmbisonicBinauralDecoder
{
    // Virtual loudspeaker configuration (8 speakers around the listener)
    // Using a cube configuration for first-order ambisonics
    private struct VirtualSpeaker
    {
        public Vector3 direction;     // Unit direction vector
        public float azimuth;          // Horizontal angle in radians
        public float elevation;        // Vertical angle in radians

        public VirtualSpeaker(float azimuthDeg, float elevationDeg)
        {
            azimuth = azimuthDeg * Mathf.Deg2Rad;
            elevation = elevationDeg * Mathf.Deg2Rad;

            // Convert spherical to cartesian
            float cosElev = Mathf.Cos(elevation);
            direction = new Vector3(
                Mathf.Sin(azimuth) * cosElev,   // X (left-right)
                Mathf.Sin(elevation),            // Y (up-down)
                Mathf.Cos(azimuth) * cosElev    // Z (front-back)
            );
        }
    }

    // 8 virtual loudspeakers in a cube configuration (optimal for FOA)
    private VirtualSpeaker[] speakers;

    // Decoding matrix: converts B-format (W, X, Y, Z) to speaker gains
    // Each row represents one speaker's coefficients for [W, X, Y, Z]
    private float[,] decodingMatrix;

    // Simple HRTF simulation using ITD (Interaural Time Difference) and ILD (Interaural Level Difference)
    // For a more sophisticated implementation, you would load actual HRTF measurements (SOFA files)
    private const float HEAD_RADIUS = 0.0875f; // Average head radius in meters (~8.75cm)
    private const float SPEED_OF_SOUND = 343.0f; // m/s at 20°C

    /// <summary>
    /// Initialize the binaural decoder with virtual loudspeaker configuration
    /// </summary>
    public AmbisonicBinauralDecoder()
    {
        InitializeVirtualSpeakers();
        ComputeDecodingMatrix();
    }

    /// <summary>
    /// Setup 8 virtual loudspeakers in a cube configuration
    /// This is optimal for first-order ambisonics decoding
    /// </summary>
    private void InitializeVirtualSpeakers()
    {
        speakers = new VirtualSpeaker[8];

        // Cube configuration: azimuth at 45, 135, 225, 315 degrees
        // Elevation at +35 and -35 degrees
        float elev = 35.26f; // arctan(1/sqrt(2)) for cube vertices

        speakers[0] = new VirtualSpeaker(45f, elev);      // Front-right-up
        speakers[1] = new VirtualSpeaker(135f, elev);     // Back-right-up
        speakers[2] = new VirtualSpeaker(225f, elev);     // Back-left-up
        speakers[3] = new VirtualSpeaker(315f, elev);     // Front-left-up
        speakers[4] = new VirtualSpeaker(45f, -elev);     // Front-right-down
        speakers[5] = new VirtualSpeaker(135f, -elev);    // Back-right-down
        speakers[6] = new VirtualSpeaker(225f, -elev);    // Back-left-down
        speakers[7] = new VirtualSpeaker(315f, -elev);    // Front-left-down
    }

    /// <summary>
    /// Compute the decoding matrix that converts B-format to speaker signals
    /// Uses the spherical harmonic coefficients for each speaker direction
    /// </summary>
    private void ComputeDecodingMatrix()
    {
        decodingMatrix = new float[8, 4]; // 8 speakers, 4 B-format channels (W, X, Y, Z)

        // B-format components (first-order spherical harmonics):
        // W = 1/sqrt(2) * Y(0,0) = omnidirectional (0.707)
        // X = Y(1,-1) = sin(azimuth) * cos(elevation) → corresponds to left-right (Unity X)
        // Y = Y(1,1) = sin(elevation) → corresponds to up-down (Unity Y)
        // Z = Y(1,0) = cos(azimuth) * cos(elevation) → corresponds to front-back (Unity Z)

        for (int i = 0; i < 8; i++)
        {
            Vector3 dir = speakers[i].direction;

            // Spherical harmonic weights for this speaker direction
            // Note: Unity uses left-handed coordinates, so we map accordingly
            decodingMatrix[i, 0] = 0.707f;           // W channel (omnidirectional, normalized)
            decodingMatrix[i, 1] = dir.z;            // X channel (front-back in Unity)
            decodingMatrix[i, 2] = dir.x;            // Y channel (left-right in Unity)
            decodingMatrix[i, 3] = dir.y;            // Z channel (up-down in Unity)
        }
    }

    /// <summary>
    /// Decode B-format ambisonic audio to binaural stereo
    /// </summary>
    /// <param name="w">W channel (omnidirectional)</param>
    /// <param name="x">X channel (front-back)</param>
    /// <param name="y">Y channel (left-right)</param>
    /// <param name="z">Z channel (up-down)</param>
    /// <param name="leftOut">Output left channel</param>
    /// <param name="rightOut">Output right channel</param>
    /// <param name="numSamples">Number of samples to process</param>
    public void DecodeToBinaural(
        float[] w, float[] x, float[] y, float[] z,
        float[] leftOut, float[] rightOut,
        int numSamples)
    {
        // Step 1: Decode B-format to virtual speaker signals
        float[][] speakerSignals = new float[8][];
        for (int i = 0; i < 8; i++)
        {
            speakerSignals[i] = new float[numSamples];
        }

        // Decode each sample
        for (int sample = 0; sample < numSamples; sample++)
        {
            // Get B-format values for this sample
            float wVal = w[sample];
            float xVal = x[sample];
            float yVal = y[sample];
            float zVal = z[sample];

            // Decode to each virtual speaker using the decoding matrix
            for (int speaker = 0; speaker < 8; speaker++)
            {
                speakerSignals[speaker][sample] =
                    decodingMatrix[speaker, 0] * wVal +
                    decodingMatrix[speaker, 1] * xVal +
                    decodingMatrix[speaker, 2] * yVal +
                    decodingMatrix[speaker, 3] * zVal;
            }
        }

        // Step 2: Apply HRTF (simplified) to create binaural output
        // For each virtual speaker, pan to left/right based on its position
        for (int sample = 0; sample < numSamples; sample++)
        {
            float leftSum = 0f;
            float rightSum = 0f;

            for (int speaker = 0; speaker < 8; speaker++)
            {
                float signal = speakerSignals[speaker][sample];

                // Calculate simple HRTF-like gains based on speaker position
                Vector3 dir = speakers[speaker].direction;

                // Calculate panning (simplified HRTF)
                // Azimuth panning: -1 (left) to +1 (right)
                float azimuth = speakers[speaker].azimuth;

                // Convert to left-right panning (-180 to 180 degrees)
                // 0° = front, 90° = left, -90° = right
                float panAngle = azimuth - Mathf.PI / 2; // Shift so 0 is right, PI is left

                // Calculate gains using constant power panning
                float panPosition = Mathf.Sin(azimuth); // -1 (left) to +1 (right)
                float rightGain = (panPosition + 1f) * 0.5f; // 0 to 1
                float leftGain = 1f - rightGain;

                // Apply simple ILD (Interaural Level Difference) based on horizontal angle
                // Sounds from the side are louder in the near ear
                float horizontalAngle = Mathf.Abs(panPosition);
                float ildFactor = 1f + horizontalAngle * 0.3f; // Up to 30% boost for extreme sides

                if (panPosition < 0) // Sound from the left
                {
                    leftGain *= ildFactor;
                }
                else // Sound from the right
                {
                    rightGain *= ildFactor;
                }

                // Apply elevation-based attenuation (sounds from above/below are slightly quieter)
                float elevationAttenuation = 1f - Mathf.Abs(Mathf.Sin(speakers[speaker].elevation)) * 0.15f;

                leftSum += signal * leftGain * elevationAttenuation;
                rightSum += signal * rightGain * elevationAttenuation;
            }

            // Normalize to prevent clipping (8 speakers summing)
            leftOut[sample] = leftSum * 0.35f;  // Empirically tuned normalization
            rightOut[sample] = rightSum * 0.35f;
        }
    }

    /// <summary>
    /// Alternative decoding method using HRTF convolution (placeholder for future implementation)
    /// This would use actual HRTF impulse responses loaded from SOFA files
    /// </summary>
    public void DecodeToBinauralWithHRTF(
        float[] w, float[] x, float[] y, float[] z,
        float[] leftOut, float[] rightOut,
        int numSamples,
        float[][] hrirLeft, float[][] hrirRight)
    {
        // TODO: Implement proper HRTF convolution using SOFA file data
        // This would involve:
        // 1. Decoding B-format to virtual speakers (same as above)
        // 2. Convolving each speaker signal with corresponding HRIR
        // 3. Summing the convolved signals for left and right ears

        // For now, fall back to the simplified method
        DecodeToBinaural(w, x, y, z, leftOut, rightOut, numSamples);
    }
}
}
