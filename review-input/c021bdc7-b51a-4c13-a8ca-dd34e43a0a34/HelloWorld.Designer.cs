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
            lblName = new Label();
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
            ShowNameButton.Click += btnDisplayName_Click;
            // 
            // lblName
            // 
            lblName.AutoSize = true;
            lblName.Location = new Point(317, 242);
            lblName.Name = "lblName";
            lblName.Size = new Size(162, 20);
            lblName.TabIndex = 1;
            lblName.Text = "click the button please!";
            // 
            // HelloWorld
            // 
            AutoScaleDimensions = new SizeF(8F, 20F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(800, 450);
            Controls.Add(lblName);
            Controls.Add(ShowNameButton);
            Name = "HelloWorld";
            Text = "Form1";
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private Button ShowNameButton;
        private Label lblName;
    }
}
