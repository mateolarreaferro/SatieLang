using System.Collections.Generic;
using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Defines a speaker layout configuration for multi-channel audio output.
    /// Maps Unity's logical audio channels to physical hardware output channels.
    /// </summary>
    [CreateAssetMenu(fileName = "SpeakerPreset", menuName = "Satie/Speaker Preset")]
    public class SatieSpeakerPreset : ScriptableObject
    {
        [Tooltip("Display name for this preset")]
        public string presetName = "New Preset";

        [Tooltip("Speaker mode (number of channels)")]
        public SpeakerMode speakerMode = SpeakerMode.Surround51;

        [Tooltip("Channel mappings from Unity to hardware outputs")]
        public List<SpeakerChannel> channels = new List<SpeakerChannel>();

        [TextArea(3, 10)]
        [Tooltip("Notes about external routing configuration for this preset")]
        public string routingNotes = "";

        /// <summary>
        /// Initialize preset with default channels for the speaker mode
        /// </summary>
        public void InitializeDefaultChannels()
        {
            channels.Clear();

            switch (speakerMode)
            {
                case SpeakerMode.Stereo:
                    channels.Add(new SpeakerChannel(ChannelRole.Left, 1));
                    channels.Add(new SpeakerChannel(ChannelRole.Right, 2));
                    break;

                case SpeakerMode.Quad:
                    channels.Add(new SpeakerChannel(ChannelRole.Left, 1));
                    channels.Add(new SpeakerChannel(ChannelRole.Right, 2));
                    channels.Add(new SpeakerChannel(ChannelRole.LeftSurround, 3));
                    channels.Add(new SpeakerChannel(ChannelRole.RightSurround, 4));
                    break;

                case SpeakerMode.Surround51:
                    channels.Add(new SpeakerChannel(ChannelRole.Left, 1));
                    channels.Add(new SpeakerChannel(ChannelRole.Right, 2));
                    channels.Add(new SpeakerChannel(ChannelRole.Center, 3));
                    channels.Add(new SpeakerChannel(ChannelRole.Subwoofer, 4));
                    channels.Add(new SpeakerChannel(ChannelRole.LeftSurround, 5));
                    channels.Add(new SpeakerChannel(ChannelRole.RightSurround, 6));
                    break;

                case SpeakerMode.Surround71:
                    channels.Add(new SpeakerChannel(ChannelRole.Left, 1));
                    channels.Add(new SpeakerChannel(ChannelRole.Right, 2));
                    channels.Add(new SpeakerChannel(ChannelRole.Center, 3));
                    channels.Add(new SpeakerChannel(ChannelRole.Subwoofer, 4));
                    channels.Add(new SpeakerChannel(ChannelRole.LeftSurround, 5));
                    channels.Add(new SpeakerChannel(ChannelRole.RightSurround, 6));
                    channels.Add(new SpeakerChannel(ChannelRole.LeftBack, 7));
                    channels.Add(new SpeakerChannel(ChannelRole.RightBack, 8));
                    break;
            }
        }

        /// <summary>
        /// Get the hardware output channel for a specific role
        /// </summary>
        public int GetHardwareChannel(ChannelRole role)
        {
            foreach (var channel in channels)
            {
                if (channel.role == role && channel.enabled)
                {
                    return channel.hardwareOutput;
                }
            }
            return -1;
        }

        /// <summary>
        /// Generate routing instructions for external configuration
        /// </summary>
        public string GenerateRoutingInstructions()
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine("=== External Routing Configuration ===");
            sb.AppendLine();
            sb.AppendLine($"Preset: {presetName}");
            sb.AppendLine($"Speaker Mode: {speakerMode}");
            sb.AppendLine();
            sb.AppendLine("Unity Channel → Hardware Output:");
            sb.AppendLine("─────────────────────────────────");

            foreach (var channel in channels)
            {
                if (channel.enabled)
                {
                    string label = string.IsNullOrEmpty(channel.customLabel)
                        ? channel.role.ToString()
                        : channel.customLabel;
                    sb.AppendLine($"  {label,-15} (Unity ch {channel.GetUnityChannel()}) → Output {channel.hardwareOutput}");
                }
            }

            sb.AppendLine();
            sb.AppendLine("Configure this in your audio interface's mixer:");
            sb.AppendLine("  • MOTU: CueMix 5 → Outputs");
            sb.AppendLine("  • RME: TotalMix FX → Software Playback");
            sb.AppendLine("  • Focusrite: Focusrite Control → Outputs");
            sb.AppendLine("  • Or: macOS Audio MIDI Setup → Configure Speakers");

            if (!string.IsNullOrEmpty(routingNotes))
            {
                sb.AppendLine();
                sb.AppendLine("Notes:");
                sb.AppendLine(routingNotes);
            }

            return sb.ToString();
        }
    }

    /// <summary>
    /// Speaker mode matching Unity's AudioSpeakerMode
    /// </summary>
    public enum SpeakerMode
    {
        Stereo = 2,
        Quad = 4,
        Surround51 = 6,
        Surround71 = 8
    }

    /// <summary>
    /// Logical audio channel roles in a surround setup
    /// </summary>
    public enum ChannelRole
    {
        Left,           // Unity channel 0
        Right,          // Unity channel 1
        Center,         // Unity channel 2
        Subwoofer,      // Unity channel 3 (LFE)
        LeftSurround,   // Unity channel 4
        RightSurround,  // Unity channel 5
        LeftBack,       // Unity channel 6 (7.1 only)
        RightBack       // Unity channel 7 (7.1 only)
    }

    /// <summary>
    /// Mapping of a single speaker channel
    /// </summary>
    [System.Serializable]
    public class SpeakerChannel
    {
        [Tooltip("Logical role of this channel")]
        public ChannelRole role;

        [Tooltip("Target hardware output channel number")]
        [Range(1, 32)]
        public int hardwareOutput = 1;

        [Tooltip("Whether this channel is active")]
        public bool enabled = true;

        [Tooltip("Custom label for this channel (optional)")]
        public string customLabel = "";

        public SpeakerChannel() { }

        public SpeakerChannel(ChannelRole role, int hardwareOutput)
        {
            this.role = role;
            this.hardwareOutput = hardwareOutput;
            this.enabled = true;
            this.customLabel = "";
        }

        /// <summary>
        /// Get the Unity channel index for this role
        /// </summary>
        public int GetUnityChannel()
        {
            return role switch
            {
                ChannelRole.Left => 0,
                ChannelRole.Right => 1,
                ChannelRole.Center => 2,
                ChannelRole.Subwoofer => 3,
                ChannelRole.LeftSurround => 4,
                ChannelRole.RightSurround => 5,
                ChannelRole.LeftBack => 6,
                ChannelRole.RightBack => 7,
                _ => 0
            };
        }

        /// <summary>
        /// Get a display name for this channel
        /// </summary>
        public string GetDisplayName()
        {
            if (!string.IsNullOrEmpty(customLabel))
                return customLabel;

            return role switch
            {
                ChannelRole.Left => "Left",
                ChannelRole.Right => "Right",
                ChannelRole.Center => "Center",
                ChannelRole.Subwoofer => "Subwoofer (LFE)",
                ChannelRole.LeftSurround => "Left Surround",
                ChannelRole.RightSurround => "Right Surround",
                ChannelRole.LeftBack => "Left Back",
                ChannelRole.RightBack => "Right Back",
                _ => role.ToString()
            };
        }
    }
}
