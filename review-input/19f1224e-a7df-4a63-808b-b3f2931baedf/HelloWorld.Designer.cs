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
            button1 = new Button();
            myLabel = new Label();
            SuspendLayout();
            // 
            // button1
            // 
            button1.Location = new Point(103, 48);
            button1.Name = "button1";
            button1.Size = new Size(172, 69);
            button1.TabIndex = 0;
            button1.Text = "button1";
            button1.UseVisualStyleBackColor = true;
            button1.Click += button1_Click;
            // 
            // myLabel
            // 
            myLabel.AutoSize = true;
            myLabel.Location = new Point(515, 249);
            myLabel.Name = "myLabel";
            myLabel.Size = new Size(162, 20);
            myLabel.TabIndex = 1;
            myLabel.Text = "click the button please!";
            // 
            // HelloWorld
            // 
            AutoScaleDimensions = new SizeF(8F, 20F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(800, 450);
            Controls.Add(myLabel);
            Controls.Add(button1);
            Name = "HelloWorld";
            Text = "Form1";
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private Button button1;
        private Label myLabel;
    }
}
