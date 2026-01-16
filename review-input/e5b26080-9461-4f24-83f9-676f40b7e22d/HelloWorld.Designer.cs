namespace activity_1
{
    partial class HelloWorld
    {
        /// <summary>
        ///  Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        ///  Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        ///  Required method for Designer support - do not modify
        ///  the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            ShowNameButton = new Button();
            NameLabel = new Label();
            SuspendLayout();
            // 
            // ShowNameButton
            // 
            ShowNameButton.Location = new Point(317, 149);
            ShowNameButton.Name = "ShowNameButton";
            ShowNameButton.Size = new Size(172, 69);
            ShowNameButton.TabIndex = 0;
            ShowNameButton.Text = "Click Me!";
            ShowNameButton.UseVisualStyleBackColor = true;
            ShowNameButton.Click += ShowNameButton_Click;
            // 
            // NameLabel
            // 
            NameLabel.AutoSize = true;
            NameLabel.Location = new Point(317, 242);
            NameLabel.Name = "NameLabel";
            NameLabel.Size = new Size(160, 20);
            NameLabel.TabIndex = 1;
            NameLabel.Text = "Name will appear here";
            // 
            // HelloWorld
            // 
            AutoScaleDimensions = new SizeF(8F, 20F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(800, 450);
            Controls.Add(NameLabel);
            Controls.Add(ShowNameButton);
            Name = "HelloWorld";
            Text = "Form1";
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private Button ShowNameButton;
        private Label NameLabel;
    }
}
