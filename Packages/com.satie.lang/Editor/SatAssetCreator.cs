// Assets/Editor/SatAssetCreator.cs
using System.IO;
using UnityEditor;
using UnityEditor.ProjectWindowCallback;
using UnityEngine;

namespace Satie.Editor
{
static class SatAssetCreator
{
    private const string kDefaultContent =
        @"# Satie Script - Hello World!
loop hello
    volume 0.8
    pitch 0.8to1.2
";

    [MenuItem("Assets/Create/Satie Script (.sat)", false, 82)]
    private static void CreateSatMenu()
    {
        // Ask the Project window to start a “new asset” rename operation.
        ProjectWindowUtil.StartNameEditingIfProjectWindowExists(
            0,
            ScriptableObject.CreateInstance<CreateSatAction>(),
            "NewSatieScript.sat",
            EditorGUIUtility.IconContent("TextAsset Icon").image as Texture2D,
            null);
    }
    

    private class CreateSatAction : EndNameEditAction
    {
        public override void Action(int instanceId, string pathName, string resourceFile)
        {
            File.WriteAllText(pathName, kDefaultContent);
            AssetDatabase.ImportAsset(pathName, ImportAssetOptions.ForceUpdate);
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(pathName);
            ProjectWindowUtil.ShowCreatedAsset(asset);
        }
    }
}
}